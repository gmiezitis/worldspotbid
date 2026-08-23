import Stripe from 'stripe';
import { getD1 } from '../../../db';
import { BID_INCREMENT_CENTS } from '../../../lib/bidding';
import { ApiError, jsonError } from '../../../lib/security';
import { getStripe, getWebhookSecret } from '../../../lib/stripe';

export const dynamic = 'force-dynamic';

type OrderRow = {
  id: string;
  country_code: string;
  country_name: string;
  user_id: string;
  amount_cents: number;
  expected_version: number;
  company_name: string;
  company_url: string;
  business_description: string | null;
  project_category: string | null;
  colorful_border: number;
  border_addon_cents: number;
  logo_key: string;
  status: string;
};

async function markEvent(event: Stripe.Event) {
  await getD1().prepare(`INSERT OR IGNORE INTO webhook_events (id, event_type, processed_at) VALUES (?, ?, ?)`).bind(event.id, event.type, Date.now()).run();
}

async function cancelAuthorization(paymentIntentId: string) {
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (['requires_capture', 'requires_payment_method', 'requires_confirmation', 'requires_action', 'processing'].includes(intent.status)) {
    await stripe.paymentIntents.cancel(paymentIntentId, {}, { idempotencyKey: `worldspot-cancel-${paymentIntentId}` });
  }
}

async function acceptBid(event: Stripe.Event, session: Stripe.Checkout.Session) {
  const orderId = session.metadata?.orderId;
  if (!orderId || session.client_reference_id !== orderId) throw new ApiError(400, 'Invalid checkout metadata.');
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (!paymentIntentId) throw new ApiError(400, 'Missing payment authorization.');

  const db = getD1();
  const order = await db.prepare(`SELECT * FROM bid_orders WHERE id = ? AND stripe_session_id = ?`).bind(orderId, session.id).first<OrderRow>();
  if (!order) throw new ApiError(400, 'Unknown checkout order.');
  const expectedTotalCents = Number(order.amount_cents) + Number(order.border_addon_cents);
  if (session.amount_total !== expectedTotalCents || session.currency !== 'usd') throw new ApiError(400, 'Checkout total does not match the placement order.');
  if (session.metadata?.colorfulBorder !== String(Boolean(order.colorful_border))) throw new ApiError(400, 'Checkout border option does not match the placement order.');
  if (['accepted', 'stale', 'payment_failed'].includes(order.status)) {
    await markEvent(event);
    return;
  }

  const now = Date.now();
  await db.prepare(`UPDATE bid_orders SET status = 'authorizing', stripe_payment_intent_id = ?, updated_at = ? WHERE id = ?`).bind(paymentIntentId, now, orderId).run();

  const acquired = await db.prepare(`
    UPDATE countries
    SET pending_bid_id = ?, pending_bid_cents = ?, pending_bid_expires_at = ?, updated_at = ?
    WHERE code = ? AND version = ? AND current_bid_cents = ?
      AND (pending_bid_id IS NULL OR pending_bid_id = ? OR pending_bid_expires_at < ?)
  `).bind(orderId, order.amount_cents, now + 10 * 60_000, now, order.country_code, order.expected_version, order.amount_cents - BID_INCREMENT_CENTS, orderId, now).run();

  if (Number(acquired.meta.changes ?? 0) !== 1) {
    await cancelAuthorization(paymentIntentId);
    await db.batch([
      db.prepare(`UPDATE bid_orders SET status = 'stale', failure_reason = 'Country was claimed first', updated_at = ? WHERE id = ?`).bind(Date.now(), orderId),
      db.prepare(`INSERT OR IGNORE INTO webhook_events (id, event_type, processed_at) VALUES (?, ?, ?)`).bind(event.id, event.type, Date.now()),
    ]);
    return;
  }

  try {
    const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
    if (intent.status === 'requires_capture') {
      await getStripe().paymentIntents.capture(paymentIntentId, {}, { idempotencyKey: `worldspot-capture-${orderId}` });
    } else if (intent.status !== 'succeeded') {
      throw new Error(`Payment authorization is ${intent.status}`);
    }
  } catch (error) {
    try { await cancelAuthorization(paymentIntentId); } catch { /* authorization expires automatically */ }
    await db.batch([
      db.prepare(`UPDATE countries SET pending_bid_id = NULL, pending_bid_cents = NULL, pending_bid_expires_at = NULL, updated_at = ? WHERE code = ? AND pending_bid_id = ?`).bind(Date.now(), order.country_code, orderId),
      db.prepare(`UPDATE bid_orders SET status = 'payment_failed', failure_reason = ?, updated_at = ? WHERE id = ?`).bind(error instanceof Error ? error.message.slice(0, 160) : 'Capture failed', Date.now(), orderId),
      db.prepare(`INSERT OR IGNORE INTO webhook_events (id, event_type, processed_at) VALUES (?, ?, ?)`).bind(event.id, event.type, Date.now()),
    ]);
    return;
  }

  const completedAt = Date.now();
  const results = await db.batch([
    db.prepare(`
      UPDATE bid_orders SET status = 'accepted', completed_at = ?, updated_at = ?
      WHERE id = ? AND EXISTS (SELECT 1 FROM countries WHERE code = ? AND pending_bid_id = ?)
    `).bind(completedAt, completedAt, orderId, order.country_code, orderId),
    db.prepare(`
      UPDATE countries SET current_bid_cents = ?, company_name = ?, company_url = ?, business_description = ?, project_category = ?, colorful_border = ?, logo_key = ?,
        owner_user_id = ?, active_since = ?, minimum_guaranteed_until = ?, version = version + 1,
        pending_bid_id = NULL, pending_bid_cents = NULL, pending_bid_expires_at = NULL, updated_at = ?
      WHERE code = ? AND pending_bid_id = ?
    `).bind(order.amount_cents, order.company_name, order.company_url, order.business_description, order.project_category, order.colorful_border, order.logo_key, order.user_id, completedAt, completedAt + 60 * 60_000, completedAt, order.country_code, orderId),
    db.prepare(`INSERT OR IGNORE INTO webhook_events (id, event_type, processed_at) VALUES (?, ?, ?)`).bind(event.id, event.type, completedAt),
  ]);
  if (Number(results[0].meta.changes ?? 0) !== 1 || Number(results[1].meta.changes ?? 0) !== 1) throw new Error('Could not finalize the activated placement.');
}

export async function POST(request: Request) {
  try {
    const signature = request.headers.get('stripe-signature');
    if (!signature) throw new ApiError(400, 'Missing Stripe signature.');
    const body = await request.text();
    if (body.length > 1_000_000) throw new ApiError(413, 'Webhook is too large.');
    const stripe = getStripe();
    const event = await stripe.webhooks.constructEventAsync(body, signature, getWebhookSecret(), undefined, Stripe.createSubtleCryptoProvider());
    if (event.type === 'checkout.session.completed') await acceptBid(event, event.data.object);
    else await markEvent(event);
    return Response.json({ received: true });
  } catch (error) {
    return jsonError(error);
  }
}
