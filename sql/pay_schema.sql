-- Pay: Stripe Connect accounts and payments for the Geiger suite
--
-- Owns the `pay` schema used by the @geiger/pay package from every Geiger product.
-- Ships with the package for review; copy it into geiger-dash/supabase/migrations (dash owns suite schemas) to apply.
--
--   pay.accounts        one connected Stripe account per organization and mode (test/live)
--   pay.payments        ledger of every Checkout / Payment Link payment made through the package
--   pay.payment_links   reusable Stripe Payment Links created for an organization
--   pay.webhook_events  processed Stripe event ids per app, so retries don't double-apply
--
-- Writes happen only through the service role (the package's server layer). Org members can see whether
-- payments are connected; only owners see payments and links. Only owners may connect or disconnect (pay.can_manage).
--
-- One-time setup: add `pay` to Supabase Settings -> API -> Exposed schemas.

-- @up
create extension if not exists pgcrypto;

create schema if not exists pay;
grant usage on schema pay to authenticated, service_role;

create or replace function pay.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

-- Owner-only: whoever manages this decides where the organization's money lands.
create or replace function pay.can_manage(target_org uuid)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select coalesce(public.org_role(target_org) = 'owner', false);
$$;
revoke all on function pay.can_manage(uuid) from public;
grant execute on function pay.can_manage(uuid) to authenticated, service_role;

create table if not exists pay.accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stripe_account_id text not null unique,
  livemode boolean not null default false,
  status text not null default 'action_required'
    check (status in ('action_required', 'pending', 'active', 'rejected', 'disconnected')),
  card_payments_status text,
  payouts_status text,
  requirements_due integer not null default 0,
  requirements_deadline timestamptz,
  country text,
  default_currency text,
  display_name text,
  contact_email text,
  connected_by uuid,
  synced_at timestamptz,
  disconnected_at timestamptz,
  disconnected_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pay_accounts_org_mode_idx
  on pay.accounts (organization_id, livemode)
  where disconnected_at is null;

create table if not exists pay.payment_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  app text not null,
  reference text,
  account_id uuid references pay.accounts(id) on delete set null,
  stripe_account_id text not null,
  livemode boolean not null default false,
  stripe_payment_link_id text unique,
  stripe_product_id text,
  stripe_price_id text,
  url text,
  name text not null,
  currency text not null,
  amount bigint not null,
  interval text check (interval in ('day', 'week', 'month', 'year')),
  application_fee_amount bigint not null default 0,
  active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pay_payment_links_org_idx on pay.payment_links (organization_id, created_at desc);
create index if not exists pay_payment_links_ref_idx on pay.payment_links (app, reference);

create table if not exists pay.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  app text not null,
  reference text,
  account_id uuid references pay.accounts(id) on delete set null,
  stripe_account_id text not null,
  livemode boolean not null default false,
  kind text not null default 'checkout' check (kind in ('checkout', 'payment_link')),
  mode text not null default 'payment' check (mode in ('payment', 'subscription')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed', 'expired', 'refunded', 'partially_refunded', 'disputed')),
  currency text not null,
  amount bigint not null default 0,
  application_fee_amount bigint not null default 0,
  amount_refunded bigint not null default 0,
  payment_link_id uuid references pay.payment_links(id) on delete set null,
  checkout_session_id text unique,
  payment_intent_id text,
  subscription_id text,
  customer_email text,
  customer_name text,
  description text,
  error text,
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pay_payments_org_idx on pay.payments (organization_id, created_at desc);
create index if not exists pay_payments_ref_idx on pay.payments (app, reference);
create index if not exists pay_payments_intent_idx on pay.payments (payment_intent_id) where payment_intent_id is not null;

create table if not exists pay.webhook_events (
  event_id text not null,
  app text not null,
  type text not null,
  account text,
  processed_at timestamptz not null default now(),
  primary key (event_id, app)
);

drop trigger if exists pay_accounts_touch on pay.accounts;
create trigger pay_accounts_touch before update on pay.accounts
for each row execute function pay.touch_updated_at();

drop trigger if exists pay_payment_links_touch on pay.payment_links;
create trigger pay_payment_links_touch before update on pay.payment_links
for each row execute function pay.touch_updated_at();

drop trigger if exists pay_payments_touch on pay.payments;
create trigger pay_payments_touch before update on pay.payments
for each row execute function pay.touch_updated_at();

alter table pay.accounts enable row level security;
alter table pay.payment_links enable row level security;
alter table pay.payments enable row level security;
alter table pay.webhook_events enable row level security;

revoke all on all tables in schema pay from anon, authenticated;
grant all on all tables in schema pay to service_role;
grant select on pay.accounts, pay.payment_links, pay.payments to authenticated;

drop policy if exists pay_accounts_select on pay.accounts;
create policy pay_accounts_select on pay.accounts
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists pay_payment_links_select on pay.payment_links;
create policy pay_payment_links_select on pay.payment_links
  for select to authenticated using (pay.can_manage(organization_id));

drop policy if exists pay_payments_select on pay.payments;
create policy pay_payments_select on pay.payments
  for select to authenticated using (pay.can_manage(organization_id));

-- No policies on pay.webhook_events on purpose: service role only.

-- @down
drop table if exists pay.webhook_events;
drop table if exists pay.payments;
drop table if exists pay.payment_links;
drop table if exists pay.accounts;
drop function if exists pay.can_manage(uuid);
drop function if exists pay.touch_updated_at();
drop schema if exists pay;
