import { PAYMENT_STATUS } from "../core/constants.js";
import { PayError, requireValue, toPayError } from "./errors.js";
import { stampMetadata } from "./metadata.js";

const REFUNDABLE = new Set([PAYMENT_STATUS.SUCCEEDED, PAYMENT_STATUS.PARTIALLY_REFUNDED, PAYMENT_STATUS.DISPUTED]);

export function createRefunds(ctx) {
  // Refunds come out of the org's Stripe balance; by default Geiger's application fee is returned with them.
  return async function refund({ paymentId, amount, reason, refundApplicationFee = true, idempotencyKey, metadata } = {}) {
    const payment = await ctx.store.getPayment(requireValue(paymentId, "paymentId"));
    if (!payment || payment.app !== ctx.app) throw new PayError("not_found", "Payment not found.", { status: 404 });
    if (!REFUNDABLE.has(payment.status) || !payment.payment_intent_id) {
      throw new PayError("not_refundable", "Only completed payments can be refunded.", { status: 409 });
    }
    const remaining = payment.amount - (payment.amount_refunded || 0);
    const value = amount == null ? remaining : Math.round(Number(amount));
    if (!(value > 0) || value > remaining) {
      throw new PayError("invalid_amount", `Refund must be between 1 and ${remaining} (minor units).`);
    }

    try {
      const stripe = await ctx.stripe();
      const result = await stripe.refunds.create(
        {
          payment_intent: payment.payment_intent_id,
          amount: value,
          ...(reason ? { reason } : {}),
          refund_application_fee: Boolean(refundApplicationFee),
          metadata: stampMetadata({
            app: ctx.app,
            organizationId: payment.organization_id,
            projectId: payment.project_id,
            paymentId: payment.id,
            reference: payment.reference,
            extra: metadata,
          }),
        },
        { stripeAccount: payment.stripe_account_id, ...(idempotencyKey ? { idempotencyKey } : {}) },
      );
      // Optimistic; the charge.refunded webhook later writes Stripe's authoritative total.
      const refunded = Math.min(payment.amount, (payment.amount_refunded || 0) + result.amount);
      const saved = await ctx.store.updatePayment(payment.id, {
        amount_refunded: refunded,
        status: refunded >= payment.amount ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED,
      });
      return { refund: result, payment: saved };
    } catch (error) {
      throw toPayError(error);
    }
  };
}
