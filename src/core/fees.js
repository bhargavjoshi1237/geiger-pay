import { normalizeCurrency } from "./money.js";

// Fixed part of a fee: a number (minor units, any currency) or a per-currency map like { usd: 30, eur: 25 }.
function fixedFor(fixed, currency) {
  if (fixed == null) return 0;
  if (typeof fixed === "number") return fixed;
  return Number(fixed[normalizeCurrency(currency)] ?? fixed.default ?? 0);
}

// Geiger's cut of a direct charge: percent of the amount plus a fixed part, clamped to [min, max] and the amount itself.
export function computeApplicationFee(amount, currency, fee) {
  const total = Math.round(Number(amount) || 0);
  if (!fee || total <= 0) return 0;
  let cut = Math.round((total * (Number(fee.percent) || 0)) / 100) + Math.round(fixedFor(fee.fixed, currency));
  if (fee.min != null) cut = Math.max(cut, fixedFor(fee.min, currency));
  if (fee.max != null) cut = Math.min(cut, fixedFor(fee.max, currency));
  return Math.max(0, Math.min(Math.round(cut), total));
}

// Subscriptions take a percentage only, so fixed parts are ignored there.
export function subscriptionFeePercent(fee) {
  const percent = Number(fee?.percent) || 0;
  return percent > 0 ? Math.min(percent, 100) : 0;
}
