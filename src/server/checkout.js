import { PAYMENT_STATUS } from "../core/constants.js";
import { cleanDescriptorSuffix } from "../core/descriptor.js";
import { computeApplicationFee, subscriptionFeePercent } from "../core/fees.js";
import { normalizeCurrency } from "../core/money.js";
import { PayError, requireValue, toPayError } from "./errors.js";
import { stampMetadata } from "./metadata.js";

function lineItem(item, currency, mode) {
  const unitAmount = Number(item?.amount);
  if (!Number.isInteger(unitAmount) || unitAmount < 0) {
    throw new PayError("invalid_amount", "Line item `amount` must be a non-negative integer in minor units.");
  }
  const quantity = Math.max(1, Math.round(Number(item.quantity ?? 1)));
  return {
    quantity,
    price_data: {
      currency,
      unit_amount: unitAmount,
      product_data: {
        name: requireValue(item.name, "lineItems[].name"),
        ...(item.description ? { description: item.description } : {}),
        ...(item.images?.length ? { images: item.images.slice(0, 8) } : {}),
      },
      ...(mode === "subscription"
        ? { recurring: { interval: item.interval || "month", interval_count: item.intervalCount || 1 } }
        : {}),
    },
  };
}

// One-off coupon on the connected account (direct charges can't use the platform's coupons).
function couponParams(discount, currency) {
  if (discount.percentOff) return { percent_off: Number(discount.percentOff) };
  if (discount.amountOff) return { amount_off: Math.round(Number(discount.amountOff)), currency };
  throw new PayError("invalid_discount", "`discount` needs `percentOff` or `amountOff`.");
}

function discountAmount(discount, subtotal) {
  if (!discount) return 0;
  if (discount.percentOff) return Math.round((subtotal * Number(discount.percentOff)) / 100);
  return Math.min(subtotal, Math.round(Number(discount.amountOff) || 0));
}

export function createCheckout(ctx, accounts) {
  // Direct charge: the Checkout Session lives on the org's Stripe account, so the money and the customer are theirs.
  return async function create(input) {
    const {
      organizationId,
      projectId = null,
      reference = null,
      lineItems,
      currency,
      mode = "payment",
      successUrl,
      cancelUrl,
      returnUrl,
      uiMode,
      customerEmail,
      discount,
      applicationFeeAmount,
      statementDescriptorSuffix,
      description,
      metadata = {},
      expiresAt,
      sessionParams = {},
      createdBy = null,
    } = input || {};

    if (!Array.isArray(lineItems) || !lineItems.length) {
      throw new PayError("invalid_request", "`lineItems` must contain at least one item.");
    }
    if (mode !== "payment" && mode !== "subscription") {
      throw new PayError("invalid_request", "`mode` must be \"payment\" or \"subscription\".");
    }
    if (!returnUrl) requireValue(successUrl, "successUrl");

    const code = normalizeCurrency(currency);
    const items = lineItems.map((item) => lineItem(item, code, mode));
    const subtotal = items.reduce((sum, item) => sum + item.price_data.unit_amount * item.quantity, 0);
    const total = Math.max(0, subtotal - discountAmount(discount, subtotal));
    const fee =
      mode === "payment"
        ? applicationFeeAmount != null
          ? Math.max(0, Math.min(Math.round(applicationFeeAmount), total))
          : computeApplicationFee(total, code, ctx.fee)
        : 0;
    const feePercent = mode === "subscription" ? subscriptionFeePercent(ctx.fee) : 0;

    let account;
    try {
      account = await accounts.requireReady(organizationId);
    } catch (error) {
      throw toPayError(error);
    }

    const payment = await ctx.store.insertPayment({
      organization_id: organizationId,
      project_id: projectId,
      app: ctx.app,
      reference,
      account_id: account.id,
      stripe_account_id: account.stripe_account_id,
      livemode: ctx.livemode,
      kind: "checkout",
      mode,
      status: PAYMENT_STATUS.PENDING,
      currency: code,
      amount: total,
      application_fee_amount: fee,
      customer_email: customerEmail || null,
      description: description || null,
      metadata,
      created_by: createdBy,
    });

    const stamp = stampMetadata({
      app: ctx.app,
      organizationId,
      projectId,
      paymentId: payment.id,
      reference,
      extra: metadata,
    });
    const options = { stripeAccount: account.stripe_account_id };

    try {
      const stripe = await ctx.stripe();
      const coupon = discount
        ? await stripe.coupons.create(
            { ...couponParams(discount, code), duration: "once", max_redemptions: 1, name: discount.name, metadata: stamp },
            { ...options, idempotencyKey: `geiger-pay-coupon-${payment.id}` },
          )
        : null;
      const suffix = cleanDescriptorSuffix(statementDescriptorSuffix);
      const { payment_intent_data: extraIntent, subscription_data: extraSubscription, ...extra } = sessionParams;

      const session = await stripe.checkout.sessions.create(
        {
          ...extra,
          mode,
          line_items: items,
          client_reference_id: payment.id,
          metadata: stamp,
          ...(uiMode ? { ui_mode: uiMode } : {}),
          ...(returnUrl ? { return_url: returnUrl } : { success_url: successUrl, cancel_url: cancelUrl || successUrl }),
          ...(customerEmail ? { customer_email: customerEmail } : {}),
          ...(coupon ? { discounts: [{ coupon: coupon.id }] } : {}),
          ...(expiresAt ? { expires_at: Math.floor(new Date(expiresAt).getTime() / 1000) } : {}),
          ...(mode === "payment"
            ? {
                payment_intent_data: {
                  ...extraIntent,
                  metadata: stamp,
                  ...(fee > 0 ? { application_fee_amount: fee } : {}),
                  ...(suffix ? { statement_descriptor_suffix: suffix } : {}),
                  ...(description ? { description } : {}),
                },
              }
            : {
                subscription_data: {
                  ...extraSubscription,
                  metadata: stamp,
                  ...(feePercent > 0 ? { application_fee_percent: feePercent } : {}),
                },
              }),
        },
        { ...options, idempotencyKey: `geiger-pay-checkout-${payment.id}` },
      );

      const saved = await ctx.store.updatePayment(payment.id, {
        checkout_session_id: session.id,
        amount: session.amount_total ?? total,
      });
      return {
        paymentId: payment.id,
        sessionId: session.id,
        url: session.url || null,
        clientSecret: session.client_secret || null,
        stripeAccountId: account.stripe_account_id,
        payment: saved,
      };
    } catch (error) {
      await ctx.store
        .updatePayment(payment.id, {
          status: PAYMENT_STATUS.FAILED,
          error: String(error?.message || error).slice(0, 500),
        })
        .catch(() => {});
      throw toPayError(error);
    }
  };
}
