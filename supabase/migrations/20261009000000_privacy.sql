-- Privacy: a consent log, and deleting an account with everything that belongs to it.

-- ---------------------------------------------------------------------------
-- Consent log: append-only. One row each time a user agrees to (or withdraws from)
-- something, with the version of the text they saw. Holds no document content.
-- ---------------------------------------------------------------------------
create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.accounts (user_id) on delete cascade,
  kind text not null check (kind in ('terms', 'privacy', 'own_handwriting')),
  -- Which version of the text: the date the page was last changed.
  version text not null check (length(version) between 1 and 40),
  granted boolean not null,
  -- Salted hash of the network address, never the address itself.
  ip_hash text,
  created_at timestamptz not null default now()
);

create index consents_user on public.consents (user_id, id);

create function public.consents_are_append_only() returns trigger
language plpgsql as $$
begin
  -- Rows disappear only together with their account (the cascade from accounts).
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'consents is append-only' using errcode = 'P0001';
end;
$$;

create trigger consents_append_only
  before update or delete on public.consents
  for each row execute function public.consents_are_append_only();

alter table public.consents enable row level security;
create policy consents_own on public.consents
  for select to authenticated using (user_id = auth.uid());

create function public.record_consent(
  p_user uuid,
  p_kind text,
  p_version text,
  p_granted boolean,
  p_ip_hash text
) returns public.consents
language plpgsql security definer set search_path = public as $$
declare
  result public.consents;
begin
  if not exists (select 1 from public.accounts where user_id = p_user) then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;
  insert into public.consents (user_id, kind, version, granted, ip_hash)
    values (p_user, p_kind, p_version, p_granted, p_ip_hash)
    returning * into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deleted accounts: a count that a deletion happened, and nothing that says whose.
-- ---------------------------------------------------------------------------
create table public.account_deletions (
  id bigint generated always as identity primary key,
  deleted_at timestamptz not null default now(),
  profiles integer not null,
  exports integer not null
);

-- No policies: only the server can read or write it.
alter table public.account_deletions enable row level security;

-- ---------------------------------------------------------------------------
-- Delete an account and every row that belongs to it. Returns what is stored outside
-- the database, so the caller can delete those files too:
--   ('profile', storage key)   one per handwriting profile
--   ('export', request hash)   one per recent export whose PDF may still be on disk
-- Refuses while a subscription is still renewing: the payment provider would keep
-- charging for an account that no longer exists.
-- ---------------------------------------------------------------------------
create function public.delete_account(p_user uuid)
returns table (kind text, key text)
language plpgsql security definer set search_path = public as $$
declare
  acct public.accounts;
  files record;
  profile_count integer := 0;
  export_count integer := 0;
begin
  select * into acct from public.accounts where user_id = p_user for update;
  if not found then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;
  if acct.plan <> 'free'
     and acct.plan_status <> 'cancelled'
     and not acct.cancel_at_period_end
     and (acct.paid_until is null or acct.paid_until > now()) then
    raise exception 'subscription_active' using errcode = 'P0001';
  end if;

  for files in
    select p.storage_key from public.handwriting_profiles p where p.user_id = p_user
  loop
    kind := 'profile';
    key := files.storage_key;
    profile_count := profile_count + 1;
    return next;
  end loop;

  select count(*) into export_count from public.exports e where e.user_id = p_user;
  for files in
    -- Finished PDFs are kept for 24 hours; two days leaves a margin.
    select distinct e.request_hash from public.exports e
     where e.user_id = p_user and e.created_at > now() - interval '2 days'
  loop
    kind := 'export';
    key := files.request_hash;
    return next;
  end loop;

  insert into public.account_deletions (profiles, exports)
    values (profile_count, export_count);

  -- Everything else follows from here: the account, its ledger, exports, profiles,
  -- consents, referrals and queued emails all cascade from the user.
  delete from auth.users where id = p_user;
end;
$$;

revoke all on public.consents, public.account_deletions from anon, authenticated;
grant select on public.consents to authenticated;
grant all on public.consents, public.account_deletions to service_role;
grant usage on all sequences in schema public to service_role;

-- Only the server may call any of these.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
