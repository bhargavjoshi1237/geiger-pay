// Stripe amounts are integers in the currency's smallest unit; these currencies have no or three decimals.
const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);
const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

export function normalizeCurrency(currency) {
  const code = String(currency || "").trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(code)) throw new TypeError(`Invalid currency "${currency}"`);
  return code;
}

export function currencyExponent(currency) {
  const code = normalizeCurrency(currency);
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

export function isZeroDecimal(currency) {
  return currencyExponent(currency) === 0;
}

// 12.5 USD -> 1250, 1200 JPY -> 1200; three-decimal amounts round to a multiple of 10 as Stripe requires.
export function toMinorUnits(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) throw new TypeError(`Invalid amount "${amount}"`);
  const exponent = currencyExponent(currency);
  const minor = Math.round(Number((value * 10 ** exponent).toFixed(4)));
  return exponent === 3 ? Math.round(minor / 10) * 10 : minor;
}

export function fromMinorUnits(minor, currency) {
  return Number(minor || 0) / 10 ** currencyExponent(currency);
}

export function formatMoney(minor, currency, locale) {
  const code = normalizeCurrency(currency);
  return new Intl.NumberFormat(locale, { style: "currency", currency: code.toUpperCase() }).format(
    fromMinorUnits(minor, code),
  );
}
