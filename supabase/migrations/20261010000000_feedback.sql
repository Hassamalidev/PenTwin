-- Feedback from users: the beta's feedback form and the "report a bad result" button.
-- Holds what the user chose to type and a few settings. Never the document or the
-- handwriting itself.

create table public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.accounts (user_id) on delete cascade,
  kind text not null check (kind in ('bad_output', 'bad_glyph', 'bug', 'idea', 'other')),
  message text not null check (length(message) between 1 and 2000),
  -- Where it happened and with which settings (page, style, pen, paper). No content.
  context jsonb not null default '{}'::jsonb check (pg_column_size(context) < 2000),
  created_at timestamptz not null default now()
);

create index feedback_user on public.feedback (user_id, id);
create index feedback_recent on public.feedback (id desc);

alter table public.feedback enable row level security;
create policy feedback_own on public.feedback
  for select to authenticated using (user_id = auth.uid());

-- A limit per person per day, so the form cannot be used to fill the database.
create function public.submit_feedback(
  p_user uuid,
  p_kind text,
  p_message text,
  p_context jsonb
) returns public.feedback
language plpgsql security definer set search_path = public as $$
declare
  result public.feedback;
begin
  perform 1 from public.accounts where user_id = p_user for update;
  if not found then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.feedback
       where user_id = p_user and created_at > now() - interval '1 day') >= 20 then
    raise exception 'feedback_limit_reached' using errcode = 'P0001';
  end if;
  insert into public.feedback (user_id, kind, message, context)
    values (p_user, p_kind, p_message, coalesce(p_context, '{}'::jsonb))
    returning * into result;
  return result;
end;
$$;

revoke all on public.feedback from anon, authenticated;
grant select on public.feedback to authenticated;
grant all on public.feedback to service_role;
grant usage on all sequences in schema public to service_role;

-- Only the server may call any of these.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
