import Stripe from 'stripe';

export function createStripeServerClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured.');
  return new Stripe(secretKey);
}

export function isStripeCheckoutConfigured(): boolean {
  return (
    process.env.STRIPE_CHECKOUT_ENABLED === 'true' &&
    Boolean(process.env.STRIPE_SECRET_KEY) &&
    Boolean(process.env.STRIPE_WEBHOOK_SECRET) &&
    Boolean(parseStripeAppUrl())
  );
}

function parseStripeAppUrl(): URL | null {
  const configuredUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.APP_URL?.trim();
  if (!configuredUrl || !URL.canParse(configuredUrl)) return null;

  const url = new URL(configuredUrl);
  const isLocalhost =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1';
  if (
    (url.protocol !== 'https:' &&
      !(process.env.NODE_ENV !== 'production' && isLocalhost)) ||
    url.username ||
    url.password
  ) {
    return null;
  }

  return url;
}

export function getStripeAppUrl(): string {
  const url = parseStripeAppUrl();
  if (!url) throw new Error('The configured Stripe Checkout URL is invalid.');
  return url.origin;
}
