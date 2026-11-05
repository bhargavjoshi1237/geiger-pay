import { computeApplicationFee, subscriptionFeePercent } from "../core/fees.js";
import { normalizeCurrency } from "../core/money.js";
import { PayError, requireValue, toPayError } from "./errors.js";
import { stampMetadata } from "./metadata.js";

export function createPaymentLinks(ctx, accounts) {
  // Reusable Stripe Payment Link on the org's account; each purchase arrives as checkout.session.completed with our metadata.
  async function create(input) {
    const {
      organizationId,
      projectId = null,
      reference = null,
      name,
      description,
      amount,
      currency,
      interval,
      allowQuantity = false,
      afterCompletionUrl,
      metadata = {},
      createdBy = null,
    } = input || {};

    const unitAmount = Number(amount);
    if (!Number.isInteger(unitAmount) || unitAmount <= 0) {
      throw new PayError("invalid_amount", "`amount` must be a positive integer in minor units.");
    }
    requireValue(name, "name");
    const code = normalizeCurrency(currency);
    const account = await accounts.requireReady(organizationId).catch((error) => {
      throw toPayError(error);
    });
    // A one-time link's fee is fixed per checkout, so it is sized from the unit price.
    const fee = interval ? 0 : computeApplicationFee(unitAmount, code, ctx.fee);
    const feePercent = interval ? subscriptionFeePercent(ctx.fee) : 0;

    const row = await ctx.store.insertLink({
      organization_id: organizationId,
      project_id: projectId,
      app: ctx.app,
      reference,
      account_id: account.id,
      stripe_account_id: account.stripe_account_id,
      livemode: ctx.livemode,
      name,
      currency: code,
      amount: unitAmount,
      interval: interval || null,
      application_fee_amount: fee,
      active: false,
      metadata,
      created_by: createdBy,
    });
    const stamp = stampMetadata({
      app: ctx.app,
      organizationId,
      projectId,
      linkId: row.id,
      reference,
      extra: metadata,
    });
    const options = { stripeAccount: account.stripe_account_id };

    try {
      const stripe = await ctx.stripe();
      const product = await stripe.products.create(
        { name, ...(description ? { description } : {}), metadata: stamp },
        { ...options, idempotencyKey: `geiger-pay-product-${row.id}` },
      );
      const price = await stripe.prices.create(
        {
          product: product.id,
          currency: code,
          unit_amount: unitAmount,
          ...(interval ? { recurring: { interval } } : {}),
          metadata: stamp,
        },
        { ...options, idempotencyKey: `geiger-pay-price-${row.id}` },
      );
      const link = await stripe.paymentLinks.create(
        {
          line_items: [
            {
              price: price.id,
              quantity: 1,
              ...(allowQuantity ? { adjustable_quantity: { enabled: true, minimum: 1 } } : {}),
            },
          ],
          metadata: stamp,
          ...(interval
            ? {
                subscription_data: { metadata: stamp },
                ...(feePercent > 0 ? { application_fee_percent: feePercent } : {}),
              }
            : {
                payment_intent_data: { metadata: stamp },
                ...(fee > 0 ? { application_fee_amount: fee } : {}),
              }),
          ...(afterCompletionUrl
            ? { after_completion: { type: "redirect", redirect: { url: afterCompletionUrl } } }
            : {}),
        },
        { ...options, idempotencyKey: `geiger-pay-link-${row.id}` },
      );

      return ctx.store.updateLink(row.id, {
        stripe_payment_link_id: link.id,
        stripe_product_id: product.id,
        stripe_price_id: price.id,
        url: link.url,
        active: true,
      });
    } catch (error) {
      throw toPayError(error);
    }
  }

  async function deactivate(linkId) {
    const row = await ctx.store.getLink(requireValue(linkId, "linkId"));
    if (!row || row.app !== ctx.app) throw new PayError("not_found", "Payment link not found.", { status: 404 });
    if (row.stripe_payment_link_id && row.active) {
      try {
        const stripe = await ctx.stripe();
        await stripe.paymentLinks.update(row.stripe_payment_link_id, { active: false }, {
          stripeAccount: row.stripe_account_id,
        });
      } catch (error) {
        throw toPayError(error);
      }
    }
    return ctx.store.updateLink(row.id, { active: false });
  }

  return { create, deactivate, get: (linkId) => ctx.store.getLink(linkId) };
}
