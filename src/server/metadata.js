import { METADATA_KEYS } from "../core/constants.js";

// Stripe metadata: at most 50 keys, 40-char keys, 500-char string values. Routing keys always win over app extras.
export function stampMetadata({ app, organizationId, projectId, paymentId, linkId, reference, extra }) {
  const metadata = {};
  for (const [key, value] of Object.entries(extra || {})) {
    if (value === undefined || value === null || Object.keys(metadata).length >= 44) continue;
    metadata[String(key).slice(0, 40)] = (typeof value === "string" ? value : JSON.stringify(value)).slice(0, 500);
  }
  const routing = {
    [METADATA_KEYS.APP]: app,
    [METADATA_KEYS.ORG]: organizationId,
    [METADATA_KEYS.PROJECT]: projectId,
    [METADATA_KEYS.PAYMENT]: paymentId,
    [METADATA_KEYS.LINK]: linkId,
    [METADATA_KEYS.REFERENCE]: reference,
  };
  for (const [key, value] of Object.entries(routing)) {
    if (value !== undefined && value !== null && value !== "") metadata[key] = String(value).slice(0, 500);
  }
  return metadata;
}
