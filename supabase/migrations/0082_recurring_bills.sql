-- ============================================================
-- 0082 — Recurring bills (HR/Operations → Super Admin to pay)
-- HR keeps a register of monthly bills (rent, internet, utilities, subscriptions …). Each
-- carries an item, amount and (optional) due-day. When a bill is due, HR clicks "Request
-- payment" → it routes to a Super Admin, who is emailed and pays it (or rejects). Recurring:
-- once paid, HR can request it again next month.
--
-- Flow:  active → pending (payment requested) → paid | rejected.  Re-requestable.
-- Reuses: next_ref, audit_write, notifications, and the same permission model as petty cash
--   (HR raises; a Super Admin — users:3 — decides). No editor-hard-lock coupling (self-service
--   pattern, like petty cash / claims).
-- ============================================================

create table if not exists public.recurring_bills (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique not null,
  entity_id     uuid references public.entities(id),
  item          text not null,
  vendor        text,
  category      text,
  amount        numeric(14,2) not null check (amount > 0),
  due_day       int check (due_day is null or (due_day between 1 and 31)),
  note          text,
  state         text not null default 'active' check (state in ('active','pending','paid','rejected')),
  created_by    uuid references public.app_users(id),
  requested_by  uuid references public.app_users(id),
  requested_at  timestamptz,
  decided_by    uuid references public.app_users(id),
  decided_at    timestamptz,
  decision_note text,
  payment_ref   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

insert into public.ref_counters(kind, prefix, n) values ('BILL', 'BILL-00', 0) on conflict (kind) do nothing;

alter table public.recurring_bills enable row level security;
drop policy if exists "read recurring bills" on public.recurring_bills;
create policy "read recurring bills" on public.recurring_bills for select to authenticated using (true);

-- ---------- permission predicates ----------
create or replace function public.can_manage_bills() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_permissions p
    join public.app_users u on lower(u.email) = p.email
    where u.auth_id = auth.uid() and p.module = 'hr' and p.level >= 2)
$$;
create or replace function public.can_approve_bills() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_permissions p
    join public.app_users u on lower(u.email) = p.email
    where u.auth_id = auth.uid() and p.module = 'users' and p.level >= 3)
$$;

-- ---------- read shape ----------
create or replace function public.rb_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', b.ref, 'item', b.item, 'vendor', b.vendor, 'category', b.category, 'amount', b.amount,
    'dueDay', b.due_day, 'note', b.note, 'state', b.state,
    'createdBy', cb.name, 'requestedBy', rb.name, 'requestedByEmail', rb.email, 'requestedAt', b.requested_at,
    'decidedBy', db.name, 'decidedAt', b.decided_at, 'decisionNote', b.decision_note, 'paymentRef', b.payment_ref,
    'createdAt', b.created_at)
  from public.recurring_bills b
  left join public.app_users cb on cb.id = b.created_by
  left join public.app_users rb on rb.id = b.requested_by
  left join public.app_users db on db.id = b.decided_by
  where b.ref = p_ref
$$;

-- ---------- add (HR) ----------
create or replace function public.add_recurring_bill(p_item text, p_vendor text, p_category text, p_amount numeric, p_due_day int default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  if not public.can_manage_bills() then raise exception 'Only HR can manage recurring bills'; end if;
  if nullif(trim(coalesce(p_item, '')), '') is null then raise exception 'What is the bill for? An item is required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  v_ref := public.next_ref('BILL');
  insert into public.recurring_bills(ref, entity_id, item, vendor, category, amount, due_day, note, created_by)
  values (v_ref, v_entity, trim(p_item), nullif(trim(coalesce(p_vendor,'')),''), nullif(trim(coalesce(p_category,'')),''),
          p_amount, p_due_day, nullif(trim(coalesce(p_note,'')),''), v_me);
  perform public.audit_write('recurring_bill.added', 'recurring_bill', v_ref, jsonb_build_object('item', p_item, 'amount', p_amount));
  return public.rb_json(v_ref);
end $$;

-- ---------- edit (HR; while not pending) ----------
create or replace function public.edit_recurring_bill(p_ref text, p_item text, p_vendor text, p_category text, p_amount numeric, p_due_day int default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if not public.can_manage_bills() then raise exception 'Only HR can manage recurring bills'; end if;
  select * into b from public.recurring_bills where ref = p_ref;
  if not found then raise exception 'Bill not found'; end if;
  if b.state = 'pending' then raise exception 'This bill is awaiting payment — you cannot edit it now'; end if;
  if nullif(trim(coalesce(p_item, '')), '') is null then raise exception 'An item is required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  update public.recurring_bills
    set item = trim(p_item), vendor = nullif(trim(coalesce(p_vendor,'')),''), category = nullif(trim(coalesce(p_category,'')),''),
        amount = p_amount, due_day = p_due_day, note = nullif(trim(coalesce(p_note,'')),''), updated_at = now()
    where ref = p_ref;
  perform public.audit_write('recurring_bill.edited', 'recurring_bill', p_ref, jsonb_build_object('item', p_item, 'amount', p_amount));
  return public.rb_json(p_ref);
end $$;

-- ---------- delete (HR; while not pending) ----------
create or replace function public.delete_recurring_bill(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if not public.can_manage_bills() then raise exception 'Only HR can manage recurring bills'; end if;
  select * into b from public.recurring_bills where ref = p_ref;
  if not found then raise exception 'Bill not found'; end if;
  if b.state = 'pending' then raise exception 'This bill is awaiting payment — you cannot remove it now'; end if;
  delete from public.recurring_bills where ref = p_ref;
  perform public.audit_write('recurring_bill.deleted', 'recurring_bill', p_ref, '{}'::jsonb);
  return jsonb_build_object('id', p_ref, 'deleted', true);
end $$;

-- ---------- request payment (HR) → routes to a Super Admin ----------
create or replace function public.request_bill_payment(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  b record; v_name text; v_emails jsonb;
begin
  if not public.can_manage_bills() then raise exception 'Only HR can request bill payments'; end if;
  select * into b from public.recurring_bills where ref = p_ref;
  if not found then raise exception 'Bill not found'; end if;
  if b.state = 'pending' then raise exception 'This bill has already been sent for payment'; end if;
  select name into v_name from public.app_users where id = v_me;

  update public.recurring_bills
    set state = 'pending', requested_by = v_me, requested_at = now(),
        decided_by = null, decided_at = null, decision_note = null, payment_ref = null, updated_at = now()
    where ref = p_ref;

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'bill_payment_request',
         coalesce(v_name,'HR') || ' requested a bill payment',
         b.item || ' — KES ' || to_char(b.amount, 'FM999,999,990'), 'finance', p_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = 'users' and p.level >= 3;

  select coalesce(jsonb_agg(distinct lower(u.email)), '[]'::jsonb) into v_emails
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = 'users' and p.level >= 3;

  perform public.audit_write('recurring_bill.requested', 'recurring_bill', p_ref, jsonb_build_object('amount', b.amount));
  return public.rb_json(p_ref) || jsonb_build_object('approverEmails', v_emails);
end $$;

-- ---------- decide (Super Admin): approve = pay, or reject ----------
create or replace function public.decide_bill_payment(p_ref text, p_approve boolean, p_payment_ref text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  b record;
begin
  if not public.can_approve_bills() then raise exception 'Only a Super Admin can pay or reject a bill'; end if;
  select * into b from public.recurring_bills where ref = p_ref;
  if not found then raise exception 'Bill not found'; end if;
  if b.state <> 'pending' then raise exception 'This bill is not awaiting payment'; end if;

  update public.recurring_bills
    set state = case when p_approve then 'paid' else 'rejected' end,
        decided_by = v_me, decided_at = now(),
        decision_note = nullif(trim(coalesce(p_note,'')),''),
        payment_ref = case when p_approve then nullif(trim(coalesce(p_payment_ref,'')),'') else null end,
        updated_at = now()
    where ref = p_ref;

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  values (v_entity, lower((select email from public.app_users where id = coalesce(b.requested_by, b.created_by))),
          'bill_payment_decided',
          case when p_approve then 'Bill paid' else 'Bill payment rejected' end,
          b.item || ' — KES ' || to_char(b.amount, 'FM999,999,990') ||
            case when p_note is not null and trim(p_note) <> '' then ' · ' || trim(p_note) else '' end,
          'hr', p_ref);
  perform public.audit_write(case when p_approve then 'recurring_bill.paid' else 'recurring_bill.rejected' end,
    'recurring_bill', p_ref, jsonb_build_object('amount', b.amount, 'paymentRef', p_payment_ref, 'note', p_note));

  return public.rb_json(p_ref);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'add_recurring_bill(text,text,text,numeric,int,text)',
    'edit_recurring_bill(text,text,text,text,numeric,int,text)',
    'delete_recurring_bill(text)',
    'request_bill_payment(text)',
    'decide_bill_payment(text,boolean,text,text)',
    'can_manage_bills()','can_approve_bills()','rb_json(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
