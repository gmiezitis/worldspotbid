import { env } from 'cloudflare:workers';
import Stripe from 'stripe';
import { ApiError } from './security';

let stripeClient: Stripe | null = null;

export function stripeIsConfigured() { return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET); }

export function getStripe() {
  if (!env.STRIPE_SECRET_KEY) throw new ApiError(503, 'Payments are not enabled yet.');
  stripeClient ??= new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
  return stripeClient;
}

export function getWebhookSecret() {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new ApiError(503, 'Payment webhooks are not configured.');
  return env.STRIPE_WEBHOOK_SECRET;
}

export function trustedAppOrigin(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  if (requestOrigin.startsWith('http://localhost:')) return requestOrigin;
  if (!env.PUBLIC_APP_ORIGIN) throw new ApiError(503, 'The payment return address is not configured.');
  let configured: URL;
  try { configured = new URL(env.PUBLIC_APP_ORIGIN); } catch { throw new ApiError(503, 'The payment return address is invalid.'); }
  if (configured.protocol !== 'https:') throw new ApiError(503, 'The payment return address must use HTTPS.');
  return configured.origin;
}
