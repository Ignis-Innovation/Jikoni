-- Petty-cash requests: staff raise a request from the Staff Portal (item, amount,
-- date needed, reason). It routes to the Finance → Petty Cash tab where HR or
-- Finance approve or reject. The requester sees the decision and can edit or
-- withdraw their own request while it is still pending. Mirrors the leave
-- self-service flow (apply → decide, editable while pending). Idempotent.

-- ---------- schema ----------
create table if not exists public.petty_cash_requests (
  id             uuid primary key default gen_random_uuid(),
  ref            text unique not null,
  entity_id      uuid references public.entities(id),
  requester_id   uuid references public.app_users(id),
  requester_name text,
  item           text not null,
  amount         numeric(14,2) not null check (amount > 0),
  need_by        date,
  reason         text,
  state          text not null default 'pending' check (state in ('pending','approved','rejected','cancelled')),
  decided_by     uuid references public.app_users(id),
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ref counter for PCR-001, PCR-002, … (next_ref requires the kind to exist)
insert into public.ref_counters(kind, prefix, n) values ('PCR', 'PCR-00', 0) on conflict (kind) do nothing;

alter table public.petty_cash_requests enable row level security;
drop policy if exists "read petty cash requests" on public.petty_cash_requests;
-- readable by any signed-in user (same model as leave_applications); the Staff
-- Portal only shows the caller's own rows, the Petty Cash tab shows the queue.
create policy "read petty cash requests" on public.petty_cash_requests for select to authenticated using (true);

-- ---------- frontend read shape ----------
create or replace function public.pcr_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.ref, 'item', r.item, 'amount', r.amount,
    'needBy', to_char(r.need_by, 'YYYY-MM-DD'), 'reason', r.reason, 'state', r.state,
    'requester', rq.name, 'requesterEmail', rq.email,
    'decidedBy', dc.name, 'decidedAt', r.decided_at, 'note', r.decision_note,
    'createdAt', r.created_at)
  from public.petty_cash_requests r
  left join public.app_users rq on rq.id = r.requester_id
  left join public.app_users dc on dc.id = r.decided_by
  where r.ref = p_ref
$$;

-- true when the caller may decide petty-cash requests (HR or Finance, edit+).
create or replace function public.can_decide_petty() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_permissions
    where email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
      and module in ('hr', 'finance') and level >= 2
  )
$$;

-- ---------- submit (staff) ----------
create or replace function public.submit_petty_cash_request(
  p_item text, p_amount numeric, p_need_by date default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_name text; v_email text;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_item, '')), '') is null then raise exception 'What is the money for? An item is required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  select name, email into v_name, v_email from public.app_users where id = v_me;
  v_ref := public.next_ref('PCR');
  insert into public.petty_cash_requests(ref, entity_id, requester_id, requester_name, item, amount, need_by, reason)
  values (v_ref, v_entity, v_me, v_name, trim(p_item), p_amount, p_need_by, nullif(trim(coalesce(p_reason, '')), ''));
  -- bell the approvers (HR + Finance, edit+)
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'petty_cash_request',
         v_name || ' requested petty cash',
         trim(p_item) || ' — KES ' || to_char(p_amount, 'FM999,999,990'), 'finance', v_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module in ('hr', 'finance') and p.level >= 2 and lower(u.email) <> lower(v_email);
  perform public.audit_write('petty_cash.requested', 'petty_cash_request', v_ref,
    jsonb_build_object('item', p_item, 'amount', p_amount));
  return public.pcr_json(v_ref);
end $$;

-- ---------- edit / withdraw (owner, while pending) ----------
create or replace function public.edit_petty_cash_request(
  p_ref text, p_item text, p_amount numeric, p_need_by date default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); r record;
begin
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if v_me is null or r.requester_id <> v_me then raise exception 'This is not your request'; end if;
  if r.state <> 'pending' then raise exception 'Only a pending request can be edited'; end if;
  if nullif(trim(coalesce(p_item, '')), '') is null then raise exception 'An item is required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  update public.petty_cash_requests
    set item = trim(p_item), amount = p_amount, need_by = p_need_by,
        reason = nullif(trim(coalesce(p_reason, '')), ''), updated_at = now()
    where ref = p_ref;
  perform public.audit_write('petty_cash.edited', 'petty_cash_request', p_ref,
    jsonb_build_object('item', p_item, 'amount', p_amount));
  return public.pcr_json(p_ref);
end $$;

create or replace function public.delete_petty_cash_request(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); r record;
begin
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if v_me is null or r.requester_id <> v_me then raise exception 'This is not your request'; end if;
  if r.state <> 'pending' then raise exception 'Only a pending request can be withdrawn'; end if;
  delete from public.petty_cash_requests where ref = p_ref;
  perform public.audit_write('petty_cash.withdrawn', 'petty_cash_request', p_ref, '{}'::jsonb);
  return jsonb_build_object('id', p_ref, 'deleted', true);
end $$;

-- ---------- decide (HR / Finance) ----------
create or replace function public.decide_petty_cash_request(p_ref text, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_who text; r record;
begin
  if not public.can_decide_petty() then raise exception 'Only HR or Finance can decide petty-cash requests'; end if;
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if r.state <> 'pending' then raise exception 'This request was already decided'; end if;
  if r.requester_id = v_me then raise exception 'You cannot decide your own request'; end if;
  update public.petty_cash_requests
    set state = case when p_approve then 'approved' else 'rejected' end,
        decided_by = v_me, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
    where ref = p_ref;
  select name into v_who from public.app_users where id = v_me;
  -- tell the requester
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  values (v_entity, lower((select email from public.app_users where id = r.requester_id)),
          'petty_cash_decided',
          'Petty cash ' || case when p_approve then 'approved' else 'rejected' end,
          r.item || ' — KES ' || to_char(r.amount, 'FM999,999,990') || case when p_note is not null and trim(p_note) <> '' then ' · ' || trim(p_note) else '' end,
          'staffportal', p_ref);
  perform public.audit_write(case when p_approve then 'petty_cash.approved' else 'petty_cash.rejected' end,
    'petty_cash_request', p_ref, jsonb_build_object('amount', r.amount, 'note', p_note));
  return public.pcr_json(p_ref);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'submit_petty_cash_request(text,numeric,date,text)',
    'edit_petty_cash_request(text,text,numeric,date,text)',
    'delete_petty_cash_request(text)',
    'decide_petty_cash_request(text,boolean,text)',
    'can_decide_petty()',
    'pcr_json(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
