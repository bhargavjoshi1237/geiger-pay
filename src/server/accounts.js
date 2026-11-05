import { ACCOUNT_STATUS } from "../core/constants.js";
import { normalizeCurrency } from "../core/money.js";
import { deriveAccountStatus, summarizeAccount } from "../core/status.js";
import { requireManager } from "./auth.js";
import { PayError, requireValue, toPayError } from "./errors.js";

const ACCOUNT_INCLUDE = ["configuration.merchant", "requirements", "identity", "defaults"];
// Don't re-ask Stripe more than once a minute when a checkout hits an account that isn't ready yet.
const RESYNC_AFTER_MS = 60_000;

function accountPatch(account) {
  const derived = deriveAccountStatus(account);
  return {
    status: derived.status,
    card_payments_status: derived.cardPaymentsStatus,
    payouts_status: derived.payoutsStatus,
    requirements_due: derived.requirementsDue,
    requirements_deadline: derived.requirementsDeadline,
    country: derived.country,
    default_currency: derived.defaultCurrency,
    display_name: derived.displayName,
    contact_email: derived.contactEmail,
    synced_at: new Date().toISOString(),
    ...(derived.status === ACCOUNT_STATUS.DISCONNECTED ? { disconnected_at: new Date().toISOString() } : {}),
  };
}

export function createAccounts(ctx) {
  const getRow = (organizationId) => ctx.store.getActiveAccount(requireValue(organizationId, "organizationId"), ctx.livemode);

  async function sync(stripeAccountId) {
    const row = await ctx.store.getAccountByStripeId(stripeAccountId);
    if (!row || row.livemode !== ctx.livemode) return null;
    const stripe = await ctx.stripe();
    const account = await stripe.v2.core.accounts.retrieve(stripeAccountId, { include: ACCOUNT_INCLUDE });
    const patch = accountPatch(account);
    if (row.disconnected_at) {
      delete patch.status;
      delete patch.disconnected_at;
    }
    return ctx.store.updateAccount(row.id, patch);
  }

  return {
    get: getRow,

    async summary(organizationId) {
      return summarizeAccount(await getRow(organizationId));
    },

    // Creates the org's connected account on first use, then returns a single-use Stripe-hosted onboarding URL.
    async startOnboarding({ session, organizationId, country, email, displayName, currency, returnUrl, refreshUrl }) {
      requireValue(returnUrl, "returnUrl");
      requireValue(refreshUrl, "refreshUrl");
      const user = await requireManager(session, requireValue(organizationId, "organizationId"));
      try {
        const stripe = await ctx.stripe();
        let row = await getRow(organizationId);
        if (!row) {
          const account = await stripe.v2.core.accounts.create({
            dashboard: "full",
            ...(displayName ? { display_name: String(displayName).slice(0, 100) } : {}),
            ...(email || user.email ? { contact_email: email || user.email } : {}),
            ...(country ? { identity: { country: String(country).toLowerCase() } } : {}),
            configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
            defaults: {
              ...(currency ? { currency: normalizeCurrency(currency) } : {}),
              responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
            },
            metadata: { geiger_org: organizationId },
            include: ACCOUNT_INCLUDE,
          });
          try {
            row = await ctx.store.insertAccount({
              organization_id: organizationId,
              stripe_account_id: account.id,
              livemode: ctx.livemode,
              connected_by: user.id,
              ...accountPatch(account),
            });
          } catch (error) {
            // A parallel request already claimed the org's slot; continue with its account.
            row = await getRow(organizationId);
            if (!row) throw error;
          }
        }
        const useCase = row.card_payments_status === "active" ? "account_update" : "account_onboarding";
        const link = await stripe.v2.core.accountLinks.create({
          account: row.stripe_account_id,
          use_case: {
            type: useCase,
            [useCase]: { configurations: ["merchant"], return_url: returnUrl, refresh_url: refreshUrl },
          },
        });
        return { url: link.url, account: summarizeAccount(row) };
      } catch (error) {
        throw toPayError(error);
      }
    },

    sync,

    // Re-reads the org's account from Stripe, e.g. on the onboarding return URL (returning doesn't mean it's ready).
    async refresh(organizationId) {
      const row = await getRow(organizationId);
      if (!row) return summarizeAccount(null);
      return summarizeAccount(await sync(row.stripe_account_id));
    },

    // Stops apps selling through the account; the owner revokes Geiger's access from their own Stripe Dashboard.
    async disconnect({ session, organizationId }) {
      const user = await requireManager(session, requireValue(organizationId, "organizationId"));
      const row = await getRow(organizationId);
      if (row) {
        await ctx.store.updateAccount(row.id, {
          status: ACCOUNT_STATUS.DISCONNECTED,
          disconnected_at: new Date().toISOString(),
          disconnected_by: user.id,
        });
      }
      return summarizeAccount(null);
    },

    async markDeauthorized(stripeAccountId) {
      const row = await ctx.store.getAccountByStripeId(stripeAccountId);
      if (!row || row.disconnected_at) return row;
      return ctx.store.updateAccount(row.id, {
        status: ACCOUNT_STATUS.DISCONNECTED,
        disconnected_at: new Date().toISOString(),
      });
    },

    async requireReady(organizationId) {
      let row = await getRow(organizationId);
      if (!row) {
        throw new PayError("account_not_connected", "This organization hasn't connected a Stripe account yet.", {
          status: 409,
        });
      }
      const stale = !row.synced_at || Date.now() - new Date(row.synced_at).getTime() > RESYNC_AFTER_MS;
      if (row.status !== ACCOUNT_STATUS.ACTIVE && stale) row = (await sync(row.stripe_account_id)) || row;
      if (row.status !== ACCOUNT_STATUS.ACTIVE) {
        throw new PayError("account_not_ready", "This organization's Stripe account can't accept payments yet.", {
          status: 409,
        });
      }
      return row;
    },
  };
}
