import { createAccounts } from "./server/accounts.js";
import { createCheckout } from "./server/checkout.js";
import { createPaymentLinks } from "./server/links.js";
import { createRefunds } from "./server/refunds.js";
import { createServiceClient, createSupabaseStore } from "./server/store.js";
import { isLiveKey, loadStripeClient, resolveSecretKey } from "./server/stripe.js";
import { createWebhooks } from "./server/webhooks.js";

// Server-only entry point. One instance per app (e.g. `createPay({ app: "events" })`), reused across requests.
export function createPay({
  app,
  stripe = null,
  secretKey,
  livemode,
  supabase = null,
  store = null,
  fee = null,
  url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
} = {}) {
  if (typeof window !== "undefined") {
    throw new Error("@geiger/pay/server must not be imported in the browser");
  }
  if (!app) throw new TypeError('createPay: `app` is required, e.g. createPay({ app: "events" })');

  const key = resolveSecretKey(secretKey);
  const ctx = {
    app,
    fee,
    livemode: livemode ?? isLiveKey(key),
    stripe: stripe ? async () => stripe : () => loadStripeClient(key),
    store: store || createSupabaseStore(supabase || (() => createServiceClient({ url, serviceRoleKey }))),
  };

  const accounts = createAccounts(ctx);
  const links = createPaymentLinks(ctx, accounts);
  const webhooks = createWebhooks(ctx, accounts);

  return {
    app,
    livemode: ctx.livemode,
    configured: Boolean(stripe || key),
    accounts,
    checkout: { create: createCheckout(ctx, accounts) },
    paymentLinks: links,
    payments: { get: (paymentId) => ctx.store.getPayment(paymentId), refund: createRefunds(ctx) },
    webhooks,
    // Escape hatch for Stripe calls the package doesn't wrap: always pass `options` so they run on the org's account.
    async stripeFor(organizationId) {
      const account = await accounts.requireReady(organizationId);
      return { stripe: await ctx.stripe(), options: { stripeAccount: account.stripe_account_id }, account };
    },
  };
}

export { PayError, serializePayError } from "./server/errors.js";
export { createSupabaseStore } from "./server/store.js";
