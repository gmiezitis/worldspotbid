declare namespace Cloudflare {
  interface Env {
    FILES: R2Bucket;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    PUBLIC_APP_ORIGIN?: string;
  }
}
