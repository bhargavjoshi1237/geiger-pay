// Statement descriptor suffixes allow latin letters, digits and spaces; Stripe rejects < > \ ' " * and caps the length at 22.
export function cleanDescriptorSuffix(value, maxLength = 22) {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[<>\\'"*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
  return /[a-z]/i.test(cleaned) ? cleaned : "";
}
