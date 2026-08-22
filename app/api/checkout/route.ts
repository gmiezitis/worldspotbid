import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { getD1 } from '../../../db';
import { getCountry } from '../../../lib/countries';
import { isProjectCategory } from '../../../lib/categories';
import { ApiError, assertSameOrigin, cleanCompanyUrl, cleanText, jsonError, readJsonObject } from '../../../lib/security';
import { getStripe, trustedAppOrigin } from '../../../lib/stripe';

export const dynamic = 'force-dynamic';

type CountryRow = { current_bid_cents: number; version: number };

export async function POST(request: Request) {
  const now = Date.now();
  let orderId: string | null = null;
  try {
    assertSameOrigin(request);
    const user = await getChatGPTUser();
    if (!user) throw new ApiError(401, 'Sign in to place a bid.');
    const body = await readJsonObject(request);
    const country = getCountry(body.countryCode);
    const companyName = cleanText(body.companyName, 'Company name', 2, 60);
    const companyUrl = cleanCompanyUrl(body.companyUrl);
    const businessDescription = cleanText(body.businessDescription, 'Business description', 10, 180);
    if (!isProjectCategory(body.projectCategory)) throw new ApiError(400, 'Choose a valid project category.');
    const projectCategory = body.projectCategory;
    let logoKey = '';
    if (body.logoKey !== undefined && body.logoKey !== null && body.logoKey !== '') {
      logoKey = cleanText(body.logoKey, 'Logo', 40, 160);
      const logo = await env.FILES.head(logoKey);
      if (!logo || logo.customMetadata?.ownerUserId !== user.userId) throw new ApiError(400, 'Upload your company logo again.');
    }

    const db = getD1();
    const recent = await db.prepare(`SELECT COUNT(*) AS count FROM bid_orders WHERE user_id = ? AND created_at > ?`).bind(user.userId, now - 10 * 60_000).first<{ count: number }>();
    if (Number(recent?.count ?? 0) >= 5) throw new ApiError(429, 'Too many checkout attempts. Try again in a few minutes.');

    await db.prepare(`INSERT OR IGNORE INTO countries (code, name, current_bid_cents, version, updated_at) VALUES (?, ?, 0, 0, ?)`).bind(country.code, country.name, now).run();
    const current = await db.prepare(`SELECT current_bid_cents, version FROM countries WHERE code = ?`).bind(country.code).first<CountryRow>();
    if (!current) throw new ApiError(500, 'Country record is unavailable.');
    const amountCents = Number(current.current_bid_cents) + 10_000;
    orderId = crypto.randomUUID();

    await db.prepare(`
      INSERT INTO bid_orders (
        id, country_code, country_name, user_id, bidder_email, amount_cents,
        expected_version, company_name, company_url, business_description, project_category, logo_key, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'creating_checkout', ?, ?)
    `).bind(orderId, country.code, country.name, user.userId, user.email, amountCents, current.version, companyName, companyUrl, businessDescription, projectCategory, logoKey, now, now).run();

    const origin = trustedAppOrigin(request);
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: user.email,
      client_reference_id: orderId,
      expires_at: Math.floor(now / 1000) + 30 * 60,
      success_url: `${origin}/?payment=processing&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?payment=cancelled`,
      metadata: { orderId, countryCode: country.code, expectedVersion: String(current.version) },
      payment_intent_data: {
        capture_method: 'manual',
        metadata: { orderId, countryCode: country.code },
      },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product_data: {
            name: `${country.name} advertising spot`,
            description: `${projectCategory} placement for at least one hour; remains visible until a higher bid is accepted.`,
          },
        },
      }],
    }, { idempotencyKey: `worldspot-checkout-${orderId}` });
    if (!session.url) throw new ApiError(502, 'Stripe did not return a checkout address.');

    await db.prepare(`UPDATE bid_orders SET stripe_session_id = ?, status = 'pending_checkout', updated_at = ? WHERE id = ?`).bind(session.id, Date.now(), orderId).run();
    return Response.json({ url: session.url, amount: amountCents / 100 });
  } catch (error) {
    if (orderId) {
      try { await getD1().prepare(`UPDATE bid_orders SET status = 'checkout_failed', failure_reason = ?, updated_at = ? WHERE id = ?`).bind(error instanceof Error ? error.message.slice(0, 160) : 'Checkout failed', Date.now(), orderId).run(); } catch { /* preserve original error */ }
    }
    return jsonError(error);
  }
}
