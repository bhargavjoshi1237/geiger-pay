import { ACCOUNT_STATUS } from "./constants.js";

const DUE_NOW = new Set(["currently_due", "past_due"]);

// Reduces a Stripe v2 Account (fetched with configuration.merchant, requirements, identity, defaults) to the fields we store.
export function deriveAccountStatus(account) {
  if (!account) return { status: ACCOUNT_STATUS.NOT_CONNECTED };

  const capabilities = account.configuration?.merchant?.capabilities || {};
  const cardPaymentsStatus = capabilities.card_payments?.status || null;
  const payoutsStatus = capabilities.stripe_balance?.payouts?.status || null;
  const userEntries = (account.requirements?.entries || []).filter(
    (entry) => entry.awaiting_action_from === "user" && DUE_NOW.has(entry.minimum_deadline?.status),
  );
  const deadline = account.requirements?.summary?.minimum_deadline || null;

  let status;
  if (account.closed) status = ACCOUNT_STATUS.DISCONNECTED;
  else if (cardPaymentsStatus === "active") status = ACCOUNT_STATUS.ACTIVE;
  else if (cardPaymentsStatus === "rejected" || cardPaymentsStatus === "unsupported") status = ACCOUNT_STATUS.REJECTED;
  else if (userEntries.length || !cardPaymentsStatus) status = ACCOUNT_STATUS.ACTION_REQUIRED;
  else status = ACCOUNT_STATUS.PENDING;

  return {
    status,
    cardPaymentsStatus,
    payoutsStatus,
    requirementsDue: userEntries.length,
    requirementsDeadline: userEntries.length ? deadline?.time || null : null,
    country: account.identity?.country ? String(account.identity.country).toUpperCase() : null,
    defaultCurrency: account.defaults?.currency || null,
    displayName: account.display_name || null,
    contactEmail: account.contact_email || null,
  };
}

export function isAccountReady(account) {
  return account?.status === ACCOUNT_STATUS.ACTIVE;
}

// Serializable view of a pay.accounts row for Client Components (no secrets live on the row, but keep it lean).
export function summarizeAccount(row) {
  if (!row || row.disconnected_at) return { status: ACCOUNT_STATUS.NOT_CONNECTED };
  return {
    id: row.id,
    status: row.status,
    ready: row.status === ACCOUNT_STATUS.ACTIVE,
    livemode: Boolean(row.livemode),
    stripeAccountId: row.stripe_account_id,
    displayName: row.display_name || null,
    contactEmail: row.contact_email || null,
    country: row.country || null,
    defaultCurrency: row.default_currency || null,
    payoutsEnabled: row.payouts_status === "active",
    requirementsDue: row.requirements_due || 0,
    requirementsDeadline: row.requirements_deadline || null,
    dashboardUrl: stripeDashboardUrl(row.livemode),
    syncedAt: row.synced_at || null,
  };
}

// Connected accounts have the full Stripe Dashboard, so the owner signs in there directly.
export function stripeDashboardUrl(livemode) {
  return livemode ? "https://dashboard.stripe.com/" : "https://dashboard.stripe.com/test/";
}
