-- Accounts, plans, the credit ledger, exports, handwriting profiles, referrals,
-- webhook de-duplication, the email outbox and cost tracking.
--
-- Rules this file enforces:
--   * Row-level security is on for every table. A signed-in user can read their own
--     rows and nothing else, and can change nothing directly.
--   * Every change goes through the functions below, which only the server
--     (service_role) may call. The server decides; the client never does.
--   * The credit ledger is append-only. A balance is always the sum of its rows.

-- ---------------------------------------------------------------------------
-- Plans: what each plan is entitled to. Prices live in the app's plan config.
-- ---------------------------------------------------------------------------
create table public.plans (
  id text primary key,
  monthly_pages integer not null check (monthly_pages >= 0),
  max_profiles integer not null check (max_profiles >= 1),
  watermark boolean not null,
  basic_options_only boolean not null
);

insert into public.plans (id, monthly_pages, max_profiles, watermark, basic_options_only) values
  ('free', 5, 1, true, true),
  ('student', 150, 3, false, false),
  ('pro', 500, 10, false, false);

-- ---------------------------------------------------------------------------
-- Accounts: one row per user.
-- ---------------------------------------------------------------------------
create table public.accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' references public.plans (id),
  billing_interval text check (billing_interval in ('month', 'year')),
  plan_status text not null default 'active'
    check (plan_status in ('active', 'past_due', 'cancelled')),
  cancel_at_period_end boolean not null default false,
  -- End of the time already paid for. Null on the free plan.
  paid_until timestamptz,
  -- Monthly credits belong to a credit period and lapse when it ends.
  credit_period_start timestamptz not null default now(),
  credit_period_end timestamptz not null default now() + interval '1 month',
  -- Free credits are granted on activation, which is rate limited, not on signup.
  activated_at timestamptz,
  activation_ip_hash text,
  activation_device_hash text,
  provider_customer_id text unique,
  provider_subscription_id text unique,
  referral_code text not null unique
    default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  referred_by uuid references public.accounts (user_id) on delete set null,
  -- Start of the credit period for which a low-credit warning was already sent.
  low_credit_notified_for timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Credit ledger: append-only. Positive rows grant pages, negative rows spend them.
--   monthly: the plan's allowance; lapses at the end of the credit period.
--   extra:   top-ups and bonuses; kept until used.
-- ---------------------------------------------------------------------------
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.accounts (user_id) on delete cascade,
  amount integer not null check (amount <> 0),
  bucket text not null check (bucket in ('monthly', 'extra')),
  kind text not null check (kind in (
    'monthly_grant', 'monthly_expiry', 'export', 'export_refund',
    'top_up', 'referral_bonus', 'adjustment'
  )),
  reason text not null check (length(reason) > 0),
  export_id uuid,
  event_id text,
  created_at timestamptz not null default now()
);

create index credit_ledger_user on public.credit_ledger (user_id, created_at desc);
-- An export is charged once and refunded at most once per bucket.
create unique index credit_ledger_export_once
  on public.credit_ledger (export_id, kind, bucket) where export_id is not null;
-- A payment event grants credits once, however often it is delivered.
create unique index credit_ledger_event_once
  on public.credit_ledger (event_id, kind, user_id) where event_id is not null;

create function public.credit_ledger_is_append_only() returns trigger
language plpgsql as $$
begin
  -- Rows disappear only together with their account (the cascade from accounts).
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'credit_ledger is append-only' using errcode = 'P0001';
end;
$$;

create trigger credit_ledger_append_only
  before update or delete on public.credit_ledger
  for each row execute function public.credit_ledger_is_append_only();

create view public.credit_balances with (security_invoker = true) as
  select
    a.user_id,
    coalesce(sum(l.amount) filter (where l.bucket = 'monthly'), 0)::integer as monthly,
    coalesce(sum(l.amount) filter (where l.bucket = 'extra'), 0)::integer as extra,
    coalesce(sum(l.amount), 0)::integer as total
  from public.accounts a
  left join public.credit_ledger l using (user_id)
  group by a.user_id;

-- ---------------------------------------------------------------------------
-- Exports: one row per export attempt. Holds no document content.
-- ---------------------------------------------------------------------------
create table public.exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.accounts (user_id) on delete cascade,
  status text not null check (status in ('reserved', 'completed', 'failed')),
  pages integer not null check (pages > 0),
  charged_pages integer not null check (charged_pages >= 0),
  watermarked boolean not null,
  plan text not null,
  -- Identifies the document and settings, for the free 24-hour repeat. Not reversible.
  request_hash text not null,
  compute_ms integer,
  output_bytes integer,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index exports_user on public.exports (user_id, created_at desc);
create index exports_repeat on public.exports (user_id, request_hash, finished_at);

-- ---------------------------------------------------------------------------
-- Handwriting profiles: where each glyph bank is stored. The bank itself is an
-- encrypted file; this row only points to it.
-- ---------------------------------------------------------------------------
create table public.handwriting_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.accounts (user_id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  storage_key text not null unique,
  size_bytes integer not null check (size_bytes > 0),
  style jsonb,
  -- The user confirmed the handwriting is their own. A profile cannot exist without it.
  own_handwriting_confirmed boolean not null check (own_handwriting_confirmed),
  created_at timestamptz not null default now()
);

create index handwriting_profiles_user on public.handwriting_profiles (user_id);

-- ---------------------------------------------------------------------------
-- Referrals.
-- ---------------------------------------------------------------------------
create table public.referral_redemptions (
  referred uuid primary key references public.accounts (user_id) on delete cascade,
  referrer uuid not null references public.accounts (user_id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.referral_rejections (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.accounts (user_id) on delete cascade,
  code text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Payment webhooks already handled, so a repeated delivery does nothing.
-- ---------------------------------------------------------------------------
create table public.webhook_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Emails waiting to be sent. Written in the same transaction as the event that
-- causes them, so an email is never sent for something that did not happen.
-- ---------------------------------------------------------------------------
create table public.email_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.accounts (user_id) on delete cascade,
  kind text not null check (kind in (
    'welcome', 'receipt', 'low_credits', 'payment_failed', 'export_ready'
  )),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text
);

create index email_outbox_pending on public.email_outbox (id) where sent_at is null;

-- ---------------------------------------------------------------------------
-- Row-level security: on for every table.
-- ---------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.accounts enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.exports enable row level security;
alter table public.handwriting_profiles enable row level security;
alter table public.referral_redemptions enable row level security;
alter table public.referral_rejections enable row level security;
alter table public.webhook_events enable row level security;
alter table public.email_outbox enable row level security;

-- Plans are public information.
create policy plans_readable on public.plans for select using (true);

-- Everything else: a user sees their own rows only. There are no insert, update or
-- delete policies, so signed-in users cannot change anything directly.
create policy accounts_own on public.accounts
  for select to authenticated using (user_id = auth.uid());
create policy credit_ledger_own on public.credit_ledger
  for select to authenticated using (user_id = auth.uid());
create policy exports_own on public.exports
  for select to authenticated using (user_id = auth.uid());
create policy handwriting_profiles_own on public.handwriting_profiles
  for select to authenticated using (user_id = auth.uid());
create policy referral_redemptions_own on public.referral_redemptions
  for select to authenticated using (referred = auth.uid() or referrer = auth.uid());
-- referral_rejections, webhook_events and email_outbox have no policies at all:
-- only the server can read or write them.

revoke all on all tables in schema public from anon, authenticated;
grant select on public.plans to anon, authenticated;
grant select on
  public.accounts, public.credit_ledger, public.credit_balances, public.exports,
  public.handwriting_profiles, public.referral_redemptions
  to authenticated;
grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- New users get an account row and a welcome email.
-- ---------------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.accounts (user_id) values (new.id);
  insert into public.email_outbox (user_id, kind) values (new.id, 'welcome');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Internal: bring an account up to date. Ends a paid plan whose time has run out,
-- and starts a new credit period when the current one is over. Locks the account
-- row, which is what makes everything built on it safe under concurrency.
-- ---------------------------------------------------------------------------
create function public.refresh_account(p_user uuid) returns public.accounts
language plpgsql security definer set search_path = public as $$
declare
  acct public.accounts;
  leftover integer;
  allowance integer;
  downgraded boolean := false;
begin
  select * into acct from public.accounts where user_id = p_user for update;
  if not found then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  if acct.plan <> 'free' and acct.paid_until is not null and acct.paid_until <= now() then
    update public.accounts
      set plan = 'free', billing_interval = null, plan_status = 'active',
          cancel_at_period_end = false, paid_until = null, provider_subscription_id = null
      where user_id = p_user
      returning * into acct;
    downgraded := true;
  end if;

  if acct.activated_at is not null and (downgraded or acct.credit_period_end <= now()) then
    select coalesce(sum(amount), 0) into leftover
      from public.credit_ledger where user_id = p_user and bucket = 'monthly';
    if leftover > 0 then
      insert into public.credit_ledger (user_id, amount, bucket, kind, reason)
        values (p_user, -leftover, 'monthly', 'monthly_expiry',
                'Unused monthly pages lapsed at the end of the period');
    end if;

    update public.accounts
      set credit_period_start = now(), credit_period_end = now() + interval '1 month',
          low_credit_notified_for = null
      where user_id = p_user
      returning * into acct;

    select monthly_pages into allowance from public.plans where id = acct.plan;
    if allowance > 0 then
      insert into public.credit_ledger (user_id, amount, bucket, kind, reason)
        values (p_user, allowance, 'monthly', 'monthly_grant',
                'Monthly pages for the ' || acct.plan || ' plan');
    end if;
  end if;

  return acct;
end;
$$;

-- ---------------------------------------------------------------------------
-- Activation: the first time a verified user opens the app. Grants the free
-- allowance. Limited per network address and per device to deter account farming.
-- ---------------------------------------------------------------------------
create function public.activate_account(p_user uuid, p_ip_hash text, p_device_hash text)
returns public.accounts
language plpgsql security definer set search_path = public as $$
declare
  acct public.accounts;
  allowance integer;
begin
  select * into acct from public.accounts where user_id = p_user for update;
  if not found then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;
  if acct.activated_at is not null then
    return public.refresh_account(p_user);
  end if;

  if not exists (
    select 1 from auth.users where id = p_user and email_confirmed_at is not null
  ) then
    raise exception 'email_not_verified' using errcode = 'P0001';
  end if;

  if (select count(*) from public.accounts
        where activation_ip_hash = p_ip_hash
          and activated_at > now() - interval '24 hours') >= 3
     or (select count(*) from public.accounts
        where activation_device_hash = p_device_hash
          and activated_at > now() - interval '30 days') >= 2 then
    raise exception 'activation_rate_limited' using errcode = 'P0001';
  end if;

  update public.accounts
    set activated_at = now(), activation_ip_hash = p_ip_hash,
        activation_device_hash = p_device_hash,
        credit_period_start = now(), credit_period_end = now() + interval '1 month'
    where user_id = p_user
    returning * into acct;

  select monthly_pages into allowance from public.plans where id = acct.plan;
  insert into public.credit_ledger (user_id, amount, bucket, kind, reason)
    values (p_user, allowance, 'monthly', 'monthly_grant',
            'Monthly pages for the ' || acct.plan || ' plan');
  return acct;
end;
$$;

-- ---------------------------------------------------------------------------
-- Exports. Pages are set aside before rendering starts, so two exports at the same
-- moment can never spend the same pages. If rendering then fails, they are given
-- back. The net effect: pages are only ever paid for exports that succeeded.
-- ---------------------------------------------------------------------------
create function public.reserve_export(p_user uuid, p_pages integer, p_request_hash text)
returns public.exports
language plpgsql security definer set search_path = public as $$
declare
  acct public.accounts;
  entitlement public.plans;
  monthly_left integer;
  extra_left integer;
  from_monthly integer;
  from_extra integer;
  charge integer := p_pages;
  result public.exports;
begin
  if p_pages is null or p_pages <= 0 then
    raise exception 'invalid_page_count' using errcode = 'P0001';
  end if;

  acct := public.refresh_account(p_user);
  if acct.activated_at is null then
    raise exception 'account_not_activated' using errcode = 'P0001';
  end if;
  select * into entitlement from public.plans where id = acct.plan;

  -- The same document and settings again within 24 hours costs nothing.
  if exists (
    select 1 from public.exports
      where user_id = p_user and request_hash = p_request_hash
        and status = 'completed' and finished_at > now() - interval '24 hours'
  ) then
    charge := 0;
  end if;

  insert into public.exports (user_id, status, pages, charged_pages, watermarked, plan, request_hash)
    values (p_user, 'reserved', p_pages, charge, entitlement.watermark, acct.plan, p_request_hash)
    returning * into result;

  if charge > 0 then
    select
      coalesce(sum(amount) filter (where bucket = 'monthly'), 0),
      coalesce(sum(amount) filter (where bucket = 'extra'), 0)
      into monthly_left, extra_left
      from public.credit_ledger where user_id = p_user;

    if monthly_left + extra_left < charge then
      raise exception 'insufficient_credits' using
        errcode = 'P0001',
        detail = format('needs %s, has %s', charge, monthly_left + extra_left);
    end if;

    -- Monthly pages go first: they lapse, top-ups and bonuses do not.
    from_monthly := least(greatest(monthly_left, 0), charge);
    from_extra := charge - from_monthly;
    if from_monthly > 0 then
      insert into public.credit_ledger (user_id, amount, bucket, kind, reason, export_id)
        values (p_user, -from_monthly, 'monthly', 'export',
                format('Exported %s pages', p_pages), result.id);
    end if;
    if from_extra > 0 then
      insert into public.credit_ledger (user_id, amount, bucket, kind, reason, export_id)
        values (p_user, -from_extra, 'extra', 'export',
                format('Exported %s pages', p_pages), result.id);
    end if;

    -- One warning per credit period when little is left.
    if monthly_left + extra_left - charge <= greatest(5, entitlement.monthly_pages / 10)
       and acct.plan <> 'free'
       and acct.low_credit_notified_for is distinct from acct.credit_period_start then
      insert into public.email_outbox (user_id, kind, payload)
        values (p_user, 'low_credits', jsonb_build_object(
          'remaining', monthly_left + extra_left - charge,
          'resets_on', acct.credit_period_end));
      update public.accounts set low_credit_notified_for = acct.credit_period_start
        where user_id = p_user;
    end if;
  end if;

  return result;
end;
$$;

create function public.complete_export(p_export uuid, p_compute_ms integer, p_output_bytes integer)
returns public.exports
language plpgsql security definer set search_path = public as $$
declare
  result public.exports;
begin
  update public.exports
    set status = 'completed', compute_ms = p_compute_ms, output_bytes = p_output_bytes,
        finished_at = now()
    where id = p_export and status = 'reserved'
    returning * into result;
  if not found then
    select * into result from public.exports where id = p_export;
    return result;
  end if;
  -- Worth an email only when the export was long enough to walk away from.
  if result.pages >= 20 then
    insert into public.email_outbox (user_id, kind, payload)
      values (result.user_id, 'export_ready', jsonb_build_object('pages', result.pages));
  end if;
  return result;
end;
$$;

create function public.fail_export(p_export uuid) returns public.exports
language plpgsql security definer set search_path = public as $$
declare
  result public.exports;
begin
  -- Locking the account first keeps this in step with other spending.
  perform 1 from public.accounts a
    join public.exports e on e.user_id = a.user_id
    where e.id = p_export for update of a;

  update public.exports set status = 'failed', finished_at = now()
    where id = p_export and status = 'reserved'
    returning * into result;
  if not found then
    select * into result from public.exports where id = p_export;
    return result;
  end if;

  insert into public.credit_ledger (user_id, amount, bucket, kind, reason, export_id)
    select user_id, -amount, bucket, 'export_refund',
           'Export failed: pages returned', export_id
      from public.credit_ledger
      where export_id = p_export and kind = 'export';
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Payments.
-- ---------------------------------------------------------------------------

-- Records a webhook delivery. Returns false if this event was already handled.
create function public.record_webhook_event(p_event_id text, p_event_type text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into public.webhook_events (event_id, event_type) values (p_event_id, p_event_type)
    on conflict (event_id) do nothing;
  return found;
end;
$$;

-- Applies the state of a subscription as the payment provider reports it.
create function public.apply_subscription(
  p_user uuid,
  p_plan text,
  p_interval text,
  p_status text,
  p_paid_until timestamptz,
  p_cancel_at_period_end boolean,
  p_customer_id text,
  p_subscription_id text
) returns public.accounts
language plpgsql security definer set search_path = public as $$
declare
  acct public.accounts;
  old_allowance integer;
  new_allowance integer;
  leftover integer;
begin
  acct := public.refresh_account(p_user);
  select monthly_pages into old_allowance from public.plans where id = acct.plan;
  select monthly_pages into new_allowance from public.plans where id = p_plan;
  if new_allowance is null or p_plan = 'free' then
    raise exception 'unknown_plan' using errcode = 'P0001';
  end if;

  update public.accounts
    set plan = p_plan, billing_interval = p_interval, plan_status = p_status,
        paid_until = p_paid_until, cancel_at_period_end = p_cancel_at_period_end,
        provider_customer_id = p_customer_id, provider_subscription_id = p_subscription_id,
        activated_at = coalesce(activated_at, now())
    where user_id = p_user
    returning * into acct;

  -- Moving up takes effect at once, with a fresh period and the larger allowance.
  -- Moving down keeps the pages already granted; the smaller allowance starts with
  -- the next credit period.
  if new_allowance > old_allowance and p_status = 'active' then
    select coalesce(sum(amount), 0) into leftover
      from public.credit_ledger where user_id = p_user and bucket = 'monthly';
    if leftover > 0 then
      insert into public.credit_ledger (user_id, amount, bucket, kind, reason)
        values (p_user, -leftover, 'monthly', 'monthly_expiry',
                'Replaced by the allowance of the new plan');
    end if;
    update public.accounts
      set credit_period_start = now(), credit_period_end = now() + interval '1 month',
          low_credit_notified_for = null
      where user_id = p_user
      returning * into acct;
    insert into public.credit_ledger (user_id, amount, bucket, kind, reason)
      values (p_user, new_allowance, 'monthly', 'monthly_grant',
              'Monthly pages for the ' || p_plan || ' plan');
  end if;
  return acct;
end;
$$;

-- Adds purchased pages. Safe to call again for the same payment event.
create function public.grant_top_up(p_user uuid, p_pages integer, p_event_id text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_account(p_user);
  insert into public.credit_ledger (user_id, amount, bucket, kind, reason, event_id)
    values (p_user, p_pages, 'extra', 'top_up',
            format('Top-up: %s pages', p_pages), p_event_id)
    on conflict do nothing;
  return found;
end;
$$;

create function public.queue_email(p_user uuid, p_kind text, p_payload jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.email_outbox (user_id, kind, payload) values (p_user, p_kind, p_payload);
$$;

-- ---------------------------------------------------------------------------
-- Referrals: 20 pages each for the inviter and the invited, once per new user.
-- Returns 'granted' or the reason it was refused. Refusals are logged.
-- ---------------------------------------------------------------------------
create function public.redeem_referral(p_user uuid, p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  acct public.accounts;
  inviter public.accounts;
  refusal text;
begin
  select * into acct from public.accounts where user_id = p_user for update;
  if not found then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;
  select * into inviter from public.accounts where referral_code = p_code;

  refusal := case
    when acct.activated_at is null then 'not_activated'
    when acct.referred_by is not null
      or exists (select 1 from public.referral_redemptions where referred = p_user)
      then 'already_referred'
    when inviter.user_id is null then 'unknown_code'
    when inviter.user_id = p_user then 'own_code'
    when acct.created_at < now() - interval '30 days' then 'account_too_old'
    -- The same network address or device as the inviter: most likely one person.
    when acct.activation_ip_hash is not distinct from inviter.activation_ip_hash
      or acct.activation_device_hash is not distinct from inviter.activation_device_hash
      then 'same_device_or_network'
    when (select count(*) from public.referral_redemptions r
            where r.referrer = inviter.user_id and r.created_at > now() - interval '30 days') >= 10
      then 'referrer_limit_reached'
    else null
  end;

  if refusal is not null then
    insert into public.referral_rejections (user_id, code, reason)
      values (p_user, p_code, refusal);
    return refusal;
  end if;

  insert into public.referral_redemptions (referred, referrer) values (p_user, inviter.user_id);
  update public.accounts set referred_by = inviter.user_id where user_id = p_user;
  insert into public.credit_ledger (user_id, amount, bucket, kind, reason) values
    (p_user, 20, 'extra', 'referral_bonus', 'Referral bonus: you joined with an invite'),
    (inviter.user_id, 20, 'extra', 'referral_bonus', 'Referral bonus: a friend you invited joined');
  return 'granted';
end;
$$;

-- ---------------------------------------------------------------------------
-- Handwriting profiles, with the per-plan limit.
-- ---------------------------------------------------------------------------
create function public.create_profile(
  p_user uuid,
  p_name text,
  p_storage_key text,
  p_size_bytes integer,
  p_style jsonb,
  p_own_handwriting_confirmed boolean
) returns public.handwriting_profiles
language plpgsql security definer set search_path = public as $$
declare
  acct public.accounts;
  allowed integer;
  result public.handwriting_profiles;
begin
  acct := public.refresh_account(p_user);
  if not coalesce(p_own_handwriting_confirmed, false) then
    raise exception 'own_handwriting_not_confirmed' using errcode = 'P0001';
  end if;
  select max_profiles into allowed from public.plans where id = acct.plan;
  if (select count(*) from public.handwriting_profiles where user_id = p_user) >= allowed then
    raise exception 'profile_limit_reached' using
      errcode = 'P0001', detail = format('the %s plan allows %s', acct.plan, allowed);
  end if;
  insert into public.handwriting_profiles
      (user_id, name, storage_key, size_bytes, style, own_handwriting_confirmed)
    values (p_user, p_name, p_storage_key, p_size_bytes, p_style, true)
    returning * into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cost tracking: compute time and output size per plan. No document content.
-- ---------------------------------------------------------------------------
create view public.export_costs with (security_invoker = true) as
  select
    plan,
    count(*)::integer as exports,
    coalesce(sum(pages), 0)::integer as pages,
    coalesce(sum(charged_pages), 0)::integer as charged_pages,
    coalesce(sum(compute_ms), 0)::bigint as compute_ms,
    coalesce(sum(output_bytes), 0)::bigint as output_bytes
  from public.exports
  where status = 'completed' and finished_at > now() - interval '30 days'
  group by plan;

revoke all on public.export_costs from anon, authenticated;
grant select on public.export_costs to service_role;

-- Only the server may call any of these.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
