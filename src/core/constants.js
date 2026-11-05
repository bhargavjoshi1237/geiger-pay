export const PAY_SCHEMA = "pay";

// Where an organization's Stripe connection stands, from "never connected" to "ready to sell".
export const ACCOUNT_STATUS = Object.freeze({
  NOT_CONNECTED: "not_connected",
  ACTION_REQUIRED: "action_required",
  PENDING: "pending",
  ACTIVE: "active",
  REJECTED: "rejected",
  DISCONNECTED: "disconnected",
});

export const PAYMENT_STATUS = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  EXPIRED: "expired",
  REFUNDED: "refunded",
  PARTIALLY_REFUNDED: "partially_refunded",
  DISPUTED: "disputed",
});

// Metadata stamped on every Stripe object the package creates, so webhooks can route events back.
export const METADATA_KEYS = Object.freeze({
  APP: "geiger_app",
  ORG: "geiger_org",
  PROJECT: "geiger_project",
  PAYMENT: "geiger_payment",
  LINK: "geiger_link",
  REFERENCE: "geiger_ref",
});

// Countries where Stripe accounts self-serve; Stripe still validates on create. India is invite-only, so it is left out.
export const CONNECT_COUNTRIES = Object.freeze([
  { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BR", name: "Brazil" },
  { code: "BG", name: "Bulgaria" },
  { code: "CA", name: "Canada" },
  { code: "HR", name: "Croatia" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czech Republic" },
  { code: "DK", name: "Denmark" },
  { code: "EE", name: "Estonia" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "GI", name: "Gibraltar" },
  { code: "GR", name: "Greece" },
  { code: "HK", name: "Hong Kong" },
  { code: "HU", name: "Hungary" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "JP", name: "Japan" },
  { code: "LV", name: "Latvia" },
  { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MY", name: "Malaysia" },
  { code: "MT", name: "Malta" },
  { code: "MX", name: "Mexico" },
  { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" },
  { code: "NO", name: "Norway" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "SG", name: "Singapore" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "TH", name: "Thailand" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
]);
