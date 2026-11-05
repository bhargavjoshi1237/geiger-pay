# @geiger/pay

Stripe Connect payments for the Geiger suite. An organization connects **its own Stripe account** once. After that, any
Geiger app can sell on its behalf: Events tickets, Assets gallery purchases, Forms payment links and so on. The money,
the customer and the Stripe Dashboard belong to the organization. Geiger can optionally take an application fee.

Source-shipped and GitHub-installed like `@geiger/ui` and `@geiger/notify`: plain JS/JSX, no build step.

```
@geiger/pay          core (browser + server): statuses, money helpers, fees, countries
@geiger/pay/server   createPay(): onboarding, checkout, payment links, refunds, webhooks (service role)
@geiger/pay/react    StripeConnectCard, AccountStatusBadge, PaymentStatusBadge
```

> **Status (2026-11-05):** implemented, not yet tested against Stripe, not wired into any app, schema not applied, not
> pushed to GitHub.

---

## How it works (and why this shape)

Stripe's current recommendation for SaaS platforms (as of Nov 2026), checked against docs.stripe.com:

| Choice | What we use | Why |
|---|---|---|
| Account API | **Accounts v2** (`stripe.v2.core.accounts`), `dashboard: "full"` | Standard, Express and Custom are deprecated for new platforms. v2 is GA and is what Stripe recommends. |
| Risk and fees | `fees_collector: "stripe"`, `losses_collector: "stripe"` | Stripe handles KYC and negative balances, and Geiger pays **no Connect fees**. These can't be changed after creation. |
| Onboarding | **Stripe-hosted Account Links** (`v2.core.accountLinks`, `account_onboarding`) | OAuth ("Connect with Stripe") is v1-only and discouraged. Hosted onboarding lets people sign in with an existing Stripe login and reuse their verified details. |
| Charge type | **Direct charges** (`{ stripeAccount }` on every call) | Funds settle in the org's balance. Their name appears on statements. Refunds and disputes are theirs. |
| Platform cut | optional `application_fee_amount` (`application_fee_percent` for subscriptions) | Set once per app with `createPay({ fee })`. |
| Readiness | `configuration.merchant.capabilities.card_payments.status === "active"` | Coming back from onboarding does **not** mean the account can take payments. |

**Linking an existing Stripe account.** Hosted onboarding uses *networked onboarding*. The owner signs in with their
existing Stripe login and their verified details are reused. Stripe then creates a **new** account under that same
login for Geiger sales, and it appears in their Stripe account switcher. Linking the exact pre-existing account would
need the deprecated v1 OAuth flow, so the package does not do it.

**Limits to know**
- **India.** Stripe India is invite-only. A non-Indian platform can't take application fees from Indian accounts, and
  an Indian platform can't take them from foreign accounts. Direct charges *without* a fee work. `IN` is left out of
  `CONNECT_COUNTRIES`.
- **Brazil.** Platforms outside Brazil can't take application fees from Brazilian accounts.
- **Fees on Payment Links.** One-time links take a fixed fee per checkout, sized from the unit price, so it doesn't
  scale with an adjustable quantity. Recurring links and subscriptions take a percentage only.
- **Disconnecting.** Disconnecting only stops Geiger apps using the account. The owner revokes access from their Stripe
  Dashboard, which arrives as `account.application.deauthorized` and is handled.
- **Test vs live.** Connected accounts are per mode. Each org has at most one active account per mode, and the mode
  comes from the secret key (`sk_live_` means live).

---

## 1. One-time setup

1. **Stripe Dashboard → Connect.** Finish the platform profile and set the brand name, colour and icon (hosted
   onboarding needs them). If the API returns `accounts_v2_access_blocked`, enable Accounts v2 for the platform. Do this
   in the sandbox first.
2. **Database.** Copy `sql/pay_schema.sql` into `geiger-dash/supabase/migrations/<timestamp>_pay_connect.sql` and run
   `npm run db:push` there. Dash owns suite schemas, the same as `notify`. Then add `pay` to **Supabase → Settings →
   API → Exposed schemas**.
3. **Webhooks**, one route per app that sells (see section 4):
   - a **Connect** endpoint (events "from connected accounts"): `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`,
     `charge.refunded`, `charge.dispute.created`, `account.updated`, `account.application.deauthorized`;
   - optionally an **event destination** (`@self`, thin events) for
     `v2.core.account[configuration.merchant].capability_status_updated`. Dash alone is enough for this, because
     account rows are shared.

   Put the signing secrets in `GEIGER_PAY_WEBHOOK_SECRET`, comma-separated when a route has two.
4. **Env**, already present in most apps: `GEIGER_STRIPE_SECRET_KEY` (falls back to `STRIPE_SECRET_KEY`),
   `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Every app must use the **same platform key**, so all apps
   see the same connected accounts.

## 2. Install & wire up

```bash
npm i github:bhargavjoshi1237/geiger-pay#<sha>
```

```js
// next.config.mjs
transpilePackages: ["@geiger/ui", "@geiger/pay"],
```

```css
/* app/globals.css */
@source "../node_modules/@geiger/pay/src";
```

Peers: `stripe` (>= 22, which has Accounts v2) for the server layer, plus `react`, `@geiger/ui`, `lucide-react` and
`@supabase/supabase-js`. All of these are already in the suite apps.

```js
// lib/pay.js (server-only)
import { createPay } from "@geiger/pay/server";

export const pay = createPay({
  app: "events",                      // stamped on every Stripe object; webhooks only act on their own app
  fee: { percent: 0, fixed: 0 },      // Geiger's cut; fixed may be { usd: 30, eur: 25 }; optional min / max
});
```

## 3. Connecting an organization's Stripe

The connect UI belongs in Dash org settings: one place per org, shared by every app.

```js
// app/org/[id]/payments/actions.js
"use server";
import { serializePayError } from "@geiger/pay/server";
import { pay } from "@/lib/pay";
import { createClient } from "@/utils/supabase/server";

export async function connectStripeAction(orgId, { country }) {
  try {
    const base = `${process.env.NEXT_PUBLIC_SITE_URL}/org/${orgId}/payments`;
    const { url } = await pay.accounts.startOnboarding({
      session: await createClient(),      // owner check runs on the user's own session (pay.can_manage)
      organizationId: orgId,
      country,
      returnUrl: `${base}?stripe=return`, // call pay.accounts.refresh(orgId) when the user lands here
      refreshUrl: `${base}?stripe=refresh`, // the link expired: start onboarding again
    });
    return { url };
  } catch (error) {
    return { error: serializePayError(error) };
  }
}
```

```jsx
// page (Server Component) → client card
const account = await pay.accounts.summary(orgId);
<StripeConnectCard
  account={account}
  canManage={isOwner}
  onConnect={connectStripeAction.bind(null, orgId)}
  onRefresh={refreshStripeAction.bind(null, orgId)}
  onDisconnect={disconnectStripeAction.bind(null, orgId)}
/>
```

Other apps only need `pay.accounts.summary(orgId)`, so they can show "Connect Stripe in organization settings" until
`summary.ready` is true.

## 4. Taking payments

**Checkout** (Events tickets, Assets gallery orders). Amounts are integers in **minor units**; use `toMinorUnits()`,
which handles JPY and the three-decimal currencies.

```js
const { url, paymentId } = await pay.checkout.create({
  organizationId: orgId,
  projectId,
  reference: order.id,                         // your own row id, returned to you in webhooks
  currency: "usd",
  lineItems: [{ name: "General admission", amount: 2500, quantity: 2 }],
  discount: { percentOff: 10, name: "Early bird" }, // optional one-off coupon on the org's account
  customerEmail,
  statementDescriptorSuffix: event.title,
  successUrl: `${base}/success?session_id={CHECKOUT_SESSION_ID}`,
  cancelUrl: `${base}/cancel`,
  metadata: { eventId: event.id },
  sessionParams: { /* any other Checkout Session params */ },
});
```

`mode: "subscription"` turns line items into monthly prices (`interval` / `intervalCount` per item). For embedded
Checkout, pass `uiMode` and `returnUrl`, then initialise Stripe.js with the returned `stripeAccountId`.

**Payment Links** (Forms):

```js
const link = await pay.paymentLinks.create({
  organizationId: orgId, reference: form.id, name: "Workshop deposit",
  amount: 5000, currency: "eur", interval: undefined /* or "month" */, afterCompletionUrl,
});
// link.url → share it; pay.paymentLinks.deactivate(link.id) to switch it off
```

**Refunds** come out of the org's balance and return Geiger's fee by default:

```js
await pay.payments.refund({ paymentId, amount: 1000 /* omit for full */, reason: "requested_by_customer" });
```

**Anything else** runs on the org's account through the escape hatch:

```js
const { stripe, options } = await pay.stripeFor(orgId);
await stripe.paymentIntents.create({ ... }, options);
```

## 5. Webhooks

```js
// app/api/pay/webhook/route.js
import { pay } from "@/lib/pay";

export const POST = pay.webhooks.handler({
  onPaymentSucceeded: async (payment, { session }) => fulfilOrder(payment.reference, session),
  onPaymentFailed: async (payment) => {},
  onPaymentExpired: async (payment) => releaseHold(payment.reference),
  onRefunded: async (payment, { charge }) => {},
  onDisputed: async (payment, { dispute }) => {},
  onAccountUpdated: async (account, { organizationId }) => {},
  onEvent: async (event, { payment }) => {}, // every verified event, e.g. invoice.paid for renewals
});
```

- Signatures are verified, and snapshot and thin v2 events share the route.
- Each event is applied once per app (`pay.webhook_events`).
- Payment states never move backwards.
- Handlers must be idempotent. If a handler throws, the route returns 500 and Stripe retries.
- Every app's Connect endpoint receives every connected-account event, so the package ignores sessions whose
  `geiger_app` isn't its own.

## 6. Data (`pay` schema)

| Table | Holds |
|---|---|
| `pay.accounts` | org → `stripe_account_id`, mode, status (`action_required` / `pending` / `active` / `rejected` / `disconnected`), capability and requirement snapshot |
| `pay.payments` | one row per checkout or link purchase: app, reference, amount, fee, refunded, session, payment intent, customer, status |
| `pay.payment_links` | links created per org/app |
| `pay.webhook_events` | processed `(event_id, app)` |

RLS: org members can read `accounts`, and only owners (`pay.can_manage`) can read `payments` and `payment_links`. All
writes go through the service role in `@geiger/pay/server`.

## Errors

Server methods throw `PayError` with a stable `code`: `stripe_unconfigured`, `supabase_unconfigured`, `unauthorized`,
`forbidden`, `account_not_connected`, `account_not_ready`, `invalid_request`, `invalid_amount`, `invalid_discount`,
`not_found`, `not_refundable`, `store_error`, or Stripe's own code. In Server Actions, return
`{ error: serializePayError(error) }`.
