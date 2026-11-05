import { PayError } from "./errors.js";

const clients = new Map();

export function resolveSecretKey(explicit) {
  return explicit || process.env.GEIGER_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY || null;
}

export function isLiveKey(key) {
  return /^(sk|rk)_live_/.test(String(key || ""));
}

// One SDK client per key; `stripe` is imported lazily so the core and tests never need it installed.
export function loadStripeClient(secretKey) {
  if (!secretKey) {
    return Promise.reject(
      new PayError("stripe_unconfigured", "Stripe is not configured: set GEIGER_STRIPE_SECRET_KEY.", { status: 503 }),
    );
  }
  if (!clients.has(secretKey)) {
    const client = import("stripe").then(
      ({ default: Stripe }) => new Stripe(secretKey, { appInfo: { name: "@geiger/pay", version: "0.1.0" } }),
    );
    client.catch(() => clients.delete(secretKey));
    clients.set(secretKey, client);
  }
  return clients.get(secretKey);
}
