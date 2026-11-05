import { PAY_SCHEMA } from "../core/constants.js";
import { PayError } from "./errors.js";

function unwrap({ data, error }, action) {
  if (error) throw new PayError("store_error", `${action}: ${error.message}`, { status: 500, cause: error });
  return data;
}

export async function createServiceClient({ url, serviceRoleKey }) {
  if (!url || !serviceRoleKey) {
    throw new PayError(
      "supabase_unconfigured",
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing.",
      { status: 503 },
    );
  }
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// Data access for the `pay` schema on a service-role client; `getClient` may be a client or an async factory.
export function createSupabaseStore(getClient) {
  let client = null;
  const table = async (name) => {
    client ??= await (typeof getClient === "function" ? getClient() : getClient);
    return client.schema(PAY_SCHEMA).from(name);
  };

  return {
    async getActiveAccount(organizationId, livemode) {
      const query = (await table("accounts"))
        .select("*")
        .eq("organization_id", organizationId)
        .eq("livemode", livemode)
        .is("disconnected_at", null);
      return unwrap(await query.maybeSingle(), "Load Stripe account");
    },
    async getAccountByStripeId(stripeAccountId) {
      const query = (await table("accounts")).select("*").eq("stripe_account_id", stripeAccountId);
      return unwrap(await query.maybeSingle(), "Load Stripe account");
    },
    async insertAccount(row) {
      return unwrap(await (await table("accounts")).insert(row).select("*").single(), "Save Stripe account");
    },
    async updateAccount(id, patch) {
      const query = (await table("accounts")).update(patch).eq("id", id).select("*");
      return unwrap(await query.single(), "Update Stripe account");
    },

    async getPayment(id) {
      return unwrap(await (await table("payments")).select("*").eq("id", id).maybeSingle(), "Load payment");
    },
    async findPayment({ checkoutSessionId, paymentIntentId }) {
      if (!checkoutSessionId && !paymentIntentId) return null;
      const query = checkoutSessionId
        ? (await table("payments")).select("*").eq("checkout_session_id", checkoutSessionId)
        : (await table("payments")).select("*").eq("payment_intent_id", paymentIntentId);
      return unwrap(await query.order("created_at", { ascending: false }).limit(1).maybeSingle(), "Find payment");
    },
    async insertPayment(row) {
      return unwrap(await (await table("payments")).insert(row).select("*").single(), "Save payment");
    },
    async updatePayment(id, patch) {
      const query = (await table("payments")).update(patch).eq("id", id).select("*");
      return unwrap(await query.single(), "Update payment");
    },

    async getLink(id) {
      return unwrap(await (await table("payment_links")).select("*").eq("id", id).maybeSingle(), "Load payment link");
    },
    async insertLink(row) {
      return unwrap(await (await table("payment_links")).insert(row).select("*").single(), "Save payment link");
    },
    async updateLink(id, patch) {
      const query = (await table("payment_links")).update(patch).eq("id", id).select("*");
      return unwrap(await query.single(), "Update payment link");
    },

    async isEventProcessed(eventId, app) {
      const query = (await table("webhook_events")).select("event_id").eq("event_id", eventId).eq("app", app);
      return Boolean(unwrap(await query.maybeSingle(), "Check webhook event"));
    },
    async markEventProcessed(row) {
      const query = (await table("webhook_events")).upsert(row, { onConflict: "event_id,app", ignoreDuplicates: true });
      unwrap(await query, "Record webhook event");
    },
  };
}
