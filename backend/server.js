/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const Stripe = require('stripe');
const path = require('path');

const app = express();
const port = Number(process.env.PORT) || 3000;
const databaseUrl = process.env.DATABASE_URL;
const startingBid = 50;
const bidIncrement = 50;
const colorfulBorderAddon = 10;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripeMode = process.env.STRIPE_MODE || 'sandbox';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const publicAppOrigin = parseHttpOrigin(process.env.PUBLIC_APP_ORIGIN);
const frontendDirectory = path.join(__dirname, '../frontend');

if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  console.error('DATABASE_URL must be a valid PostgreSQL URL');
  process.exit(1);
}

if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
  console.error('DATABASE_URL must use the postgres or postgresql protocol');
  process.exit(1);
}

const poolConfig = {
  connectionString: databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

// Render external PostgreSQL hosts require TLS. If DATABASE_URL already has an
// sslmode parameter, node-postgres applies it directly from the URL.
if (parsedDatabaseUrl.hostname.endsWith('.render.com') && !parsedDatabaseUrl.searchParams.has('sslmode')) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

app.disable('x-powered-by');
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use((request, response, next) => {
  const origin = request.get('origin');
  if (publicAppOrigin && origin === publicAppOrigin) {
    response.set('Access-Control-Allow-Origin', publicAppOrigin);
    response.set('Access-Control-Allow-Headers', 'Content-Type');
    response.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.set('Vary', 'Origin');
  }

  if (request.method === 'OPTIONS') return response.sendStatus(origin === publicAppOrigin ? 204 : 403);
  return next();
});

app.use(express.json({ limit: '100kb' }));
app.use(express.static(frontendDirectory, {
  index: false,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}));

app.get('/', (_request, response) => {
  response.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/api/status', (_request, response) => {
  response.json({ status: 'WorldSpotBid server is alive and running!' });
});

app.get('/health/database', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('Database health check failed:', error.message);
    response.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

app.get('/api/countries', async (_request, response) => {
  try {
    const result = await pool.query(`
      SELECT
        LOWER(country_code) AS code,
        current_price AS "currentBid",
        current_logo AS "logoUrl",
        current_link AS "companyUrl",
        company_name AS "companyName",
        business_description AS "businessDescription",
        project_category AS "projectCategory",
        colorful_border AS "colorfulBorder",
        CASE
          WHEN auction_ends_at IS NULL THEN NULL
          ELSE FLOOR(EXTRACT(EPOCH FROM auction_ends_at) * 1000)::BIGINT
        END AS "minimumGuaranteedUntil"
      FROM countries
      WHERE current_price > 0
      ORDER BY country_code ASC
    `);

    response.json({
      countries: result.rows.map((country) => ({
        ...country,
        currentBid: Number(country.currentBid),
        minimumGuaranteedUntil: country.minimumGuaranteedUntil
          ? Number(country.minimumGuaranteedUntil)
          : null,
        companyName: country.companyName || companyNameFromUrl(country.companyUrl),
      })),
      paymentsEnabled: Boolean(
        stripe
        && stripeWebhookSecret
        && publicAppOrigin
        && stripeMode === 'sandbox'
        && stripeSecretKey.startsWith('sk_test_')
      ),
    });
  } catch (error) {
    console.error('Unable to load countries:', error.message);
    response.status(500).json({ error: 'Unable to load countries.' });
  }
});

app.get('/api/order-status', async (request, response) => {
  const sessionId = request.query.session_id;
  if (typeof sessionId !== 'string' || !/^cs_test_[A-Za-z0-9_]+$/.test(sessionId)) {
    return response.status(400).json({ error: 'Invalid checkout session.' });
  }

  try {
    const result = await pool.query(`
      SELECT bids.status, bids.country_code
      FROM bids
      WHERE bids.stripe_session_id = $1
      LIMIT 1
    `, [sessionId]);
    if (result.rowCount === 0) return response.status(404).json({ error: 'Checkout was not found.' });

    return response.json({
      status: result.rows[0].status,
      countryName: result.rows[0].country_code,
    });
  } catch (error) {
    console.error('Unable to load checkout status:', error.message);
    return response.status(500).json({ error: 'Unable to load checkout status.' });
  }
});

app.post('/api/bid', async (request, response) => {
  if (!stripe || !stripeWebhookSecret || !publicAppOrigin) {
    return response.status(503).json({
      error: 'Stripe sandbox is not fully configured.',
    });
  }

  if (stripeMode !== 'sandbox' || !stripeSecretKey.startsWith('sk_test_')) {
    return response.status(503).json({ error: 'Only Stripe sandbox payments are enabled.' });
  }

  const requestOrigin = request.get('origin');
  if (requestOrigin && requestOrigin !== publicAppOrigin) {
    return response.status(403).json({ error: 'Request origin is not allowed.' });
  }

  const countryCode = normalizeCountryCode(request.body?.country_code);
  const logoUrl = normalizeUrl(request.body?.logo_url, 'logo_url', { optional: true });
  const linkUrl = normalizeUrl(request.body?.link_url, 'link_url');
  const companyName = normalizeOptionalText(request.body?.company_name, 60);
  const businessDescription = normalizeOptionalText(request.body?.business_description, 180);
  const projectCategory = normalizeOptionalText(request.body?.project_category, 80);
  const colorfulBorder = request.body?.colorful_border === true;

  if (!countryCode.ok) return response.status(400).json({ error: countryCode.error });
  if (!logoUrl.ok) return response.status(400).json({ error: logoUrl.error });
  if (!linkUrl.ok) return response.status(400).json({ error: linkUrl.error });
  if (!companyName.ok || !businessDescription.ok || !projectCategory.ok) {
    return response.status(400).json({ error: 'Company information is invalid.' });
  }

  const client = await pool.connect();
  let transactionOpen = false;
  let bidId;
  let checkoutSession;

  try {
    await client.query('BEGIN');
    transactionOpen = true;

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [countryCode.value]);
    await client.query(`
      INSERT INTO countries (country_code, current_price)
      VALUES ($1, 0)
      ON CONFLICT (country_code) DO NOTHING
    `, [countryCode.value]);

    await client.query(`
      UPDATE bids
      SET status = 'expired', updated_at = NOW()
      WHERE country_code = $1
        AND status IN ('creating_checkout', 'pending_checkout')
        AND checkout_expires_at < NOW()
    `, [countryCode.value]);

    const pendingResult = await client.query(`
      SELECT id
      FROM bids
      WHERE country_code = $1
        AND status IN ('creating_checkout', 'pending_checkout', 'capturing')
      LIMIT 1
    `, [countryCode.value]);

    if (pendingResult.rowCount > 0) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return response.status(409).json({ error: 'A checkout is already active for this country.' });
    }

    const currentResult = await client.query(
      'SELECT current_price FROM countries WHERE country_code = $1 FOR UPDATE',
      [countryCode.value],
    );
    const currentPrice = Number(currentResult.rows[0].current_price);
    const newPrice = currentPrice === 0 ? startingBid : currentPrice + bidIncrement;

    const bidResult = await client.query(`
      INSERT INTO bids (
        country_code, amount, logo_url, link_url, status,
        expected_current_price, checkout_expires_at, updated_at,
        company_name, business_description, project_category, colorful_border, border_addon
      )
      VALUES (
        $1, $2, $3, $4, 'creating_checkout', $5, NOW() + INTERVAL '31 minutes', NOW(),
        $6, $7, $8, $9, $10
      )
      RETURNING id, amount, created_at, checkout_expires_at
    `, [
      countryCode.value,
      newPrice,
      logoUrl.value,
      linkUrl.value,
      currentPrice,
      companyName.value,
      businessDescription.value,
      projectCategory.value,
      colorfulBorder,
      colorfulBorder ? colorfulBorderAddon : 0,
    ]);
    bidId = bidResult.rows[0].id;

    await client.query('COMMIT');
    transactionOpen = false;

    checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      managed_payments: { enabled: false },
      success_url: `${publicAppOrigin}/?payment=processing&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${publicAppOrigin}/?payment=cancelled`,
      expires_at: Math.floor(new Date(bidResult.rows[0].checkout_expires_at).getTime() / 1000),
      metadata: {
        bidId: String(bidId),
        countryCode: countryCode.value,
        expectedCurrentPrice: String(currentPrice),
      },
      payment_intent_data: {
        capture_method: 'manual',
        metadata: { bidId: String(bidId), countryCode: countryCode.value },
      },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: newPrice * 100,
          product_data: {
            name: `${countryCode.value} country placement`,
            description: 'One-hour WorldSpotBid country placement in Stripe sandbox mode.',
          },
        },
      }, ...(colorfulBorder ? [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: colorfulBorderAddon * 100,
          product_data: {
            name: 'Colorful country border',
            description: 'High-visibility border shown while the placement is active.',
          },
        },
      }] : [])],
    }, { idempotencyKey: `worldspot-sandbox-checkout-${bidId}` });

    if (!checkoutSession.url) throw new Error('Stripe Checkout did not return a URL');

    await pool.query(`
      UPDATE bids
      SET stripe_session_id = $1, status = 'pending_checkout', updated_at = NOW()
      WHERE id = $2 AND status = 'creating_checkout'
    `, [checkoutSession.id, bidId]);

    return response.status(201).json({
      success: true,
      payment: 'stripe_sandbox',
      checkout_url: checkoutSession.url,
      bid: {
        id: bidId,
        amount: newPrice,
        created_at: bidResult.rows[0].created_at,
      },
    });
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    if (checkoutSession?.id) {
      await stripe.checkout.sessions.expire(checkoutSession.id).catch(() => {});
    }
    if (bidId) {
      await pool.query(`
        UPDATE bids
        SET status = 'checkout_failed', failure_reason = $1, updated_at = NOW()
        WHERE id = $2 AND status = 'creating_checkout'
      `, [String(error.message).slice(0, 255), bidId]).catch(() => {});
    }
    console.error('Unable to create Stripe sandbox checkout:', error.message);
    return response.status(502).json({ error: 'Unable to create Stripe sandbox checkout.' });
  } finally {
    client.release();
  }
});

async function handleStripeWebhook(request, response) {
  if (!stripe || !stripeWebhookSecret) {
    return response.status(503).json({ error: 'Stripe webhook is not configured.' });
  }

  const signature = request.get('stripe-signature');
  if (!signature) return response.status(400).json({ error: 'Missing Stripe signature.' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(request.body, signature, stripeWebhookSecret);
  } catch (error) {
    console.warn('Stripe webhook signature verification failed:', error.message);
    return response.status(400).json({ error: 'Invalid Stripe signature.' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await acceptAuthorizedCheckout(event.data.object);
    } else if (event.type === 'checkout.session.expired') {
      await pool.query(`
        UPDATE bids
        SET status = 'expired', updated_at = NOW()
        WHERE stripe_session_id = $1
          AND status IN ('creating_checkout', 'pending_checkout')
      `, [event.data.object.id]);
    }

    return response.json({ received: true });
  } catch (error) {
    console.error(`Stripe webhook ${event.id} failed:`, error.message);
    return response.status(500).json({ error: 'Webhook processing failed.' });
  }
}

async function acceptAuthorizedCheckout(session) {
  const bidId = Number.parseInt(session.metadata?.bidId, 10);
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;

  if (!Number.isSafeInteger(bidId) || !paymentIntentId) {
    throw new Error('Checkout session is missing bid metadata or a PaymentIntent');
  }

  const client = await pool.connect();
  let shouldCancel = false;

  try {
    await client.query('BEGIN');
    const bidResult = await client.query('SELECT * FROM bids WHERE id = $1 FOR UPDATE', [bidId]);
    const bid = bidResult.rows[0];

    if (!bid || bid.stripe_session_id !== session.id) throw new Error('Unknown Stripe checkout session');
    if (bid.status === 'accepted') {
      await client.query('COMMIT');
      return;
    }

    const expectedTotalCents = (Number(bid.amount) + Number(bid.border_addon || 0)) * 100;
    if (session.currency !== 'usd' || Number(session.amount_total) !== expectedTotalCents) {
      throw new Error('Stripe checkout amount does not match the bid');
    }

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [bid.country_code]);
    const countryResult = await client.query(
      'SELECT current_price FROM countries WHERE country_code = $1 FOR UPDATE',
      [bid.country_code],
    );
    const currentPrice = Number(countryResult.rows[0]?.current_price ?? 0);

    if (currentPrice !== Number(bid.expected_current_price)) {
      shouldCancel = true;
      await client.query(`
        UPDATE bids
        SET status = 'stale', stripe_payment_intent_id = $1,
            failure_reason = 'Country price changed before authorization completed', updated_at = NOW()
        WHERE id = $2
      `, [paymentIntentId, bidId]);
      await client.query('COMMIT');
    } else {
      await client.query(`
        UPDATE bids
        SET status = 'capturing', stripe_payment_intent_id = $1, updated_at = NOW()
        WHERE id = $2
      `, [paymentIntentId, bidId]);
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (shouldCancel) {
    await stripe.paymentIntents.cancel(paymentIntentId, {}, {
      idempotencyKey: `worldspot-cancel-stale-bid-${bidId}`,
    });
    return;
  }

  await stripe.paymentIntents.capture(paymentIntentId, {}, {
    idempotencyKey: `worldspot-capture-bid-${bidId}`,
  });

  const finalizeClient = await pool.connect();
  try {
    await finalizeClient.query('BEGIN');
    const bidResult = await finalizeClient.query('SELECT * FROM bids WHERE id = $1 FOR UPDATE', [bidId]);
    const bid = bidResult.rows[0];
    if (!bid) throw new Error('Bid disappeared before capture finalization');
    if (bid.status === 'accepted') {
      await finalizeClient.query('COMMIT');
      return;
    }
    if (bid.status !== 'capturing') throw new Error(`Bid cannot be finalized from status ${bid.status}`);

    await finalizeClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [bid.country_code]);
    const countryResult = await finalizeClient.query(
      'SELECT current_price FROM countries WHERE country_code = $1 FOR UPDATE',
      [bid.country_code],
    );
    if (Number(countryResult.rows[0]?.current_price ?? 0) !== Number(bid.expected_current_price)) {
      throw new Error('Country price changed during payment capture');
    }

    await finalizeClient.query(`
      UPDATE countries
      SET current_price = $1, current_logo = $2, current_link = $3,
          company_name = $4, business_description = $5, project_category = $6,
          colorful_border = $7, auction_ends_at = NOW() + INTERVAL '1 hour'
      WHERE country_code = $8
    `, [
      bid.amount,
      bid.logo_url,
      bid.link_url,
      bid.company_name,
      bid.business_description,
      bid.project_category,
      bid.colorful_border,
      bid.country_code,
    ]);

    await finalizeClient.query(`
      UPDATE bids
      SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [bidId]);

    await finalizeClient.query('COMMIT');
  } catch (error) {
    await finalizeClient.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    finalizeClient.release();
  }
}

function parseHttpOrigin(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function companyNameFromUrl(value) {
  if (!value) return null;
  try {
    const hostname = new URL(value).hostname.replace(/^www\./, '');
    const name = hostname.split('.')[0].replace(/[-_]+/g, ' ').trim();
    return name ? name.replace(/\b\w/g, (letter) => letter.toUpperCase()) : hostname;
  } catch {
    return null;
  }
}

function normalizeOptionalText(value, maxLength) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maxLength) return { ok: false };
  return { ok: true, value: normalized };
}

function normalizeCountryCode(value) {
  if (typeof value !== 'string' || !/^[a-z]{2}$/i.test(value.trim())) {
    return { ok: false, error: 'country_code must be a two-letter country code.' };
  }

  return { ok: true, value: value.trim().toUpperCase() };
}

function normalizeUrl(value, fieldName, options = {}) {
  if (options.optional && (value === undefined || value === null || value === '')) {
    return { ok: true, value: null };
  }

  if (typeof value !== 'string' || value.length > 255) {
    return { ok: false, error: `${fieldName} must be a URL of at most 255 characters.` };
  }

  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
    return { ok: true, value: parsed.toString() };
  } catch {
    return { ok: false, error: `${fieldName} must be a valid HTTP or HTTPS URL.` };
  }
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS countries (
      country_code VARCHAR(2) PRIMARY KEY,
      current_price INTEGER NOT NULL DEFAULT 50 CHECK (current_price >= 0),
      current_logo VARCHAR(255),
      current_link VARCHAR(255),
      company_name VARCHAR(60),
      business_description VARCHAR(180),
      project_category VARCHAR(80),
      colorful_border BOOLEAN NOT NULL DEFAULT FALSE,
      auction_ends_at TIMESTAMP WITH TIME ZONE
    )
  `);

  await pool.query(`
    ALTER TABLE countries
      ADD COLUMN IF NOT EXISTS company_name VARCHAR(60),
      ADD COLUMN IF NOT EXISTS business_description VARCHAR(180),
      ADD COLUMN IF NOT EXISTS project_category VARCHAR(80),
      ADD COLUMN IF NOT EXISTS colorful_border BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE countries
    ALTER COLUMN current_price SET DEFAULT 50
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bids (
      id SERIAL PRIMARY KEY,
      country_code VARCHAR(2) NOT NULL REFERENCES countries(country_code),
      amount INTEGER NOT NULL CHECK (amount > 0),
      logo_url VARCHAR(255),
      link_url VARCHAR(255) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'accepted',
      expected_current_price INTEGER NOT NULL DEFAULT 0,
      stripe_session_id VARCHAR(255),
      stripe_payment_intent_id VARCHAR(255),
      checkout_expires_at TIMESTAMP WITH TIME ZONE,
      failure_reason VARCHAR(255),
      accepted_at TIMESTAMP WITH TIME ZONE,
      company_name VARCHAR(60),
      business_description VARCHAR(180),
      project_category VARCHAR(80),
      colorful_border BOOLEAN NOT NULL DEFAULT FALSE,
      border_addon INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE bids
      ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'accepted',
      ADD COLUMN IF NOT EXISTS expected_current_price INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS checkout_expires_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS failure_reason VARCHAR(255),
      ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS company_name VARCHAR(60),
      ADD COLUMN IF NOT EXISTS business_description VARCHAR(180),
      ADD COLUMN IF NOT EXISTS project_category VARCHAR(80),
      ADD COLUMN IF NOT EXISTS colorful_border BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS border_addon INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE bids
    ALTER COLUMN status SET DEFAULT 'creating_checkout'
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS bids_country_created_idx
    ON bids (country_code, created_at DESC)
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS bids_stripe_session_uidx
    ON bids (stripe_session_id)
    WHERE stripe_session_id IS NOT NULL
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS bids_one_active_checkout_per_country_uidx
    ON bids (country_code)
    WHERE status IN ('creating_checkout', 'pending_checkout', 'capturing')
  `);
}

let server;

async function startServer() {
  if (stripeMode !== 'sandbox') {
    throw new Error('STRIPE_MODE must remain sandbox until test-mode verification is complete');
  }
  if (stripeSecretKey && !stripeSecretKey.startsWith('sk_test_')) {
    throw new Error('Sandbox mode requires a Stripe sk_test_ secret key');
  }

  await initializeDatabase();
  console.log('PostgreSQL connection pool and bidding tables are ready');

  if (!stripe || !stripeWebhookSecret || !publicAppOrigin) {
    console.warn('Stripe sandbox bidding is disabled until its key, webhook secret, and app origin are configured');
  }

  server = app.listen(port, '0.0.0.0', () => {
    console.log(`WorldSpotBid server listening on port ${port}`);
  });

  return server;
}

if (require.main === module) {
  startServer().catch(async (error) => {
    console.error('Server startup failed:', error.message);
    await pool.end().catch(() => {});
    process.exit(1);
  });
}

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  if (!server) {
    await pool.end().catch(() => {});
    process.exit(0);
  }

  server.close(async () => {
    try {
      await pool.end();
      process.exit(0);
    } catch (error) {
      console.error('PostgreSQL pool shutdown failed:', error.message);
      process.exit(1);
    }
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

module.exports = { app, pool, initializeDatabase, startServer };
