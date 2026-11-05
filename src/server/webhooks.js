import { METADATA_KEYS, PAYMENT_STATUS } from "../core/constants.js";
import { summarizeAccount } from "../core/status.js";
import { PayError } from "./errors.js";

const { PENDING, PROCESSING, SUCCEEDED, FAILED, EXPIRED, REFUNDED, PARTIALLY_REFUNDED, DISPUTED } = PAYMENT_STATUS;

// Events can arrive out of order; a payment never moves back to an earlier state.
const RANK = { [PENDING]: 0, [PROCESSING]: 1, [EXPIRED]: 2, [FAILED]: 2, [SUCCEEDED]: 3, [PARTIALLY_REFUNDED]: 4, [DISPUTED]: 4, [REFUNDED]: 5 };

const SESSION_STATUS = {
  "checkout.session.completed": (session) => (session.payment_status === "unpaid" ? PROCESSING : SUCCEEDED),
  "checkout.session.async_payment_succeeded": () => SUCCEEDED,
  "checkout.session.async_payment_failed": () => FAILED,
  "checkout.session.expired": () => EXPIRED,
};

const HANDLER_FOR = {
  [SUCCEEDED]: "onPaymentSucceeded",
  [PROCESSING]: "onPaymentProcessing",
  [FAILED]: "onPaymentFailed",
  [EXPIRED]: "onPaymentExpired",
};

const idOf = (value) => (typeof value === "string" ? value : value?.id || null);

function secretsFrom(secret) {
  const raw = secret ?? process.env.GEIGER_PAY_WEBHOOK_SECRET ?? "";
  return [].concat(raw).flatMap((value) => String(value || "").split(",")).map((value) => value.trim()).filter(Boolean);
}

export function createWebhooks(ctx, accounts) {
  async function paymentForSession(session) {
    const metadata = session.metadata || {};
    let payment = await ctx.store.findPayment({ checkoutSessionId: session.id });
    if (!payment && metadata[METADATA_KEYS.PAYMENT]) payment = await ctx.store.getPayment(metadata[METADATA_KEYS.PAYMENT]);
    if (payment || !metadata[METADATA_KEYS.LINK]) return payment;

    // Payment Link purchases have no pending row yet; open one from the link.
    const link = await ctx.store.getLink(metadata[METADATA_KEYS.LINK]);
    if (!link) return null;
    try {
      return await ctx.store.insertPayment({
        organization_id: link.organization_id,
        project_id: link.project_id,
        app: link.app,
        reference: link.reference,
        account_id: link.account_id,
        stripe_account_id: link.stripe_account_id,
        livemode: link.livemode,
        kind: "payment_link",
        mode: session.mode === "subscription" ? "subscription" : "payment",
        payment_link_id: link.id,
        status: PENDING,
        currency: session.currency || link.currency,
        amount: session.amount_total ?? link.amount,
        application_fee_amount: link.application_fee_amount || 0,
        checkout_session_id: session.id,
        metadata: link.metadata || {},
      });
    } catch {
      // A concurrent delivery for the same session created it first.
      return ctx.store.findPayment({ checkoutSessionId: session.id });
    }
  }

  async function onSession(event, handlers) {
    const session = event.data.object;
    if (session.metadata?.[METADATA_KEYS.APP] !== ctx.app) return null;
    const payment = await paymentForSession(session);
    if (!payment) return null;

    const status = SESSION_STATUS[event.type](session);
    const patch = {
      checkout_session_id: session.id,
      payment_intent_id: idOf(session.payment_intent) || payment.payment_intent_id || null,
      subscription_id: idOf(session.subscription) || payment.subscription_id || null,
      customer_email: session.customer_details?.email || payment.customer_email || null,
      customer_name: session.customer_details?.name || payment.customer_name || null,
      ...(session.amount_total != null ? { amount: session.amount_total } : {}),
    };
    // Equal rank still applies, so a retried delivery re-runs the app handler that failed last time.
    const advances = (RANK[status] ?? 0) >= (RANK[payment.status] ?? 0);
    if (advances) {
      patch.status = status;
      if (status === SUCCEEDED && !payment.paid_at) patch.paid_at = new Date().toISOString();
    }
    const saved = await ctx.store.updatePayment(payment.id, patch);
    const handler = advances ? handlers[HANDLER_FOR[status]] : null;
    if (handler) await handler(saved, { event, session, stripeAccount: event.account || null });
    return saved;
  }

  async function onCharge(event, handlers) {
    const object = event.data.object;
    const payment = await ctx.store.findPayment({ paymentIntentId: idOf(object.payment_intent) });
    if (!payment || payment.app !== ctx.app) return null;

    if (event.type === "charge.refunded") {
      const saved = await ctx.store.updatePayment(payment.id, {
        amount_refunded: object.amount_refunded,
        status: object.refunded ? REFUNDED : PARTIALLY_REFUNDED,
      });
      await handlers.onRefunded?.(saved, { event, charge: object, stripeAccount: event.account || null });
      return saved;
    }
    const saved = await ctx.store.updatePayment(payment.id, { status: DISPUTED });
    await handlers.onDisputed?.(saved, { event, dispute: object, stripeAccount: event.account || null });
    return saved;
  }

  async function syncAccount(stripeAccountId, event, handlers) {
    if (!stripeAccountId) return;
    const row = await accounts.sync(stripeAccountId);
    if (row) await handlers.onAccountUpdated?.(summarizeAccount(row), { event, organizationId: row.organization_id });
  }

  // Applies one verified event to the ledger and calls the app's handlers. App handlers must be idempotent.
  async function process(event, handlers = {}) {
    if (event.object === "v2.core.event") {
      if (String(event.type).startsWith("v2.core.account")) await syncAccount(event.related_object?.id, event, handlers);
      await handlers.onEvent?.(event, {});
      return { handled: true };
    }
    if (await ctx.store.isEventProcessed(event.id, ctx.app)) return { duplicate: true };

    let payment = null;
    switch (event.type) {
      case "account.updated":
        await syncAccount(event.account || event.data?.object?.id, event, handlers);
        break;
      case "account.application.deauthorized": {
        const row = event.account ? await accounts.markDeauthorized(event.account) : null;
        if (row) await handlers.onAccountUpdated?.(summarizeAccount(null), { event, organizationId: row.organization_id });
        break;
      }
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired":
        payment = await onSession(event, handlers);
        break;
      case "charge.refunded":
      case "charge.dispute.created":
        payment = await onCharge(event, handlers);
        break;
      default:
        break;
    }
    await handlers.onEvent?.(event, { payment });
    await ctx.store.markEventProcessed({
      event_id: event.id,
      app: ctx.app,
      type: event.type,
      account: event.account || null,
    });
    return { handled: true, payment };
  }

  // Snapshot events (Connect endpoints) and thin v2 events (event destinations) arrive on the same route.
  async function verify(body, signature, secrets) {
    let thin;
    try {
      thin = JSON.parse(body)?.object === "v2.core.event";
    } catch {
      throw new PayError("invalid_payload", "Webhook body is not JSON.");
    }
    const stripe = await ctx.stripe();
    // Older stripe-node majors named the thin-event parser parseThinEvent.
    const parseThin = (stripe.parseEventNotification || stripe.parseThinEvent)?.bind(stripe);
    let lastError;
    for (const secret of secrets) {
      try {
        return thin ? parseThin(body, signature, secret) : stripe.webhooks.constructEvent(body, signature, secret);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  // Route handler: `export const POST = pay.webhooks.handler({ onPaymentSucceeded })`.
  function handler({ secret, ...handlers } = {}) {
    return async function POST(request) {
      const secrets = secretsFrom(secret);
      if (!secrets.length) return Response.json({ error: "webhook_unconfigured" }, { status: 503 });
      const signature = request.headers.get("stripe-signature");
      if (!signature) return Response.json({ error: "missing_signature" }, { status: 400 });

      const body = await request.text();
      let event;
      try {
        event = await verify(body, signature, secrets);
      } catch {
        return Response.json({ error: "invalid_signature" }, { status: 400 });
      }
      try {
        await process(event, handlers);
        return Response.json({ received: true });
      } catch (error) {
        console.error("[geiger-pay] webhook failed", event?.type, event?.id, error);
        return Response.json({ error: "handler_failed" }, { status: 500 });
      }
    };
  }

  return { handler, process };
}
