import { PAY_SCHEMA } from "../core/constants.js";
import { PayError } from "./errors.js";

// Connecting or replacing where an org's money lands is owner-only; `pay.can_manage` holds that rule in one place.
export async function requireManager(session, organizationId) {
  if (!session?.auth) {
    throw new PayError("unauthorized", "A signed-in Supabase session client is required.", { status: 401 });
  }
  const { data, error } = await session.auth.getUser();
  if (error || !data?.user) throw new PayError("unauthorized", "Sign in to manage payments.", { status: 401 });

  const result = await session.schema(PAY_SCHEMA).rpc("can_manage", { target_org: organizationId });
  if (result.error) {
    throw new PayError("store_error", `Check payment permissions: ${result.error.message}`, { status: 500 });
  }
  if (result.data !== true) {
    throw new PayError("forbidden", "Only organization owners can manage the Stripe connection.", { status: 403 });
  }
  return data.user;
}
