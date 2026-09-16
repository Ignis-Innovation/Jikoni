-- ============================================================
-- 0080 — Travel advances (Expenses & Claims, Phase 2)
-- Cash given to staff BEFORE a field trip, because they can't float hotel + fuel.
-- The opposite of a reimbursement: money goes out first and is accounted for later.
--
-- Key control (the reason this is separate from a claim): an ISSUED advance is a
-- receivable OWED BY THE HOLDER, not a project cost. It posts to the project's actuals
-- ONLY on reconciliation, and only the reconciled (actually-spent) amount — so an unspent
-- advance never overstates a project.
--
-- Flow:  pending → approved → issued (open receivable) → reconciled (posts spent to
--        project) → settled (balance returned/topped up).  Rejected ends it early.
--
-- Reuses the claims spine: next_ref, audit_write, assert_access, notifications, routing
-- via can_petty_super()/can_petty_hr(), per_diem_rate() config, project_expenses +
-- recompute_project_money. Receipts never block progress (same policy as claims, 0079).
-- ============================================================

-- ---------- schema ----------
create table if not exists public.travel_advances (
  id             uuid primary key default gen_random_uuid(),
  ref            text unique not null,
  entity_id      uuid references public.entities(id),
  holder_id      uuid references public.app_users(id),   -- the person given the cash (also the requester)
  holder_name    text,
  purpose        text not null,
  project_code   text,
  amount         numeric(14,2) not null check (amount > 0),   -- the advance amount requested/approved
  approver_role  text,                                        -- 'hr' | 'super' | 'auto'
  state          text not null default 'pending'
                   check (state in ('pending','approved','issued','reconciled','settled','rejected','cancelled')),
  -- approval
  decided_by     uuid references public.app_users(id),
  decided_at     timestamptz,
  decision_note  text,
  -- issue (Finance pays the cash out)
  issued_by      uuid references public.app_users(id),
  issued_at      timestamptz,
  issue_ref      text,
  -- reconcile (holder accounts for it on return)
  spent_amount   numeric(14,2),                               -- sum of reconciliation lines
  balance        numeric(14,2),                               -- amount - spent (+ = holder returns, - = top up)
  reconciled_at  timestamptz,
  -- settle (balance cleared)
  settled_by     uuid references public.app_users(id),
  settled_at     timestamptz,
  settle_note    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.travel_advance_lines (
  id                 uuid primary key default gen_random_uuid(),
  advance_id         uuid not null references public.travel_advances(id) on delete cascade,
  category           text not null,
  detail             text,
  amount             numeric(14,2) not null default 0 check (amount >= 0),
  receipt_path       text,
  is_per_diem        boolean not null default false,
  per_diem_days      int,
  per_diem_rate_used numeric(14,2),
  created_at         timestamptz not null default now(),
  constraint travel_advance_lines_category_ck check (
    (is_per_diem and category = 'per_diem') or
    (not is_per_diem and category in ('transport','accommodation','meals','airtime','supplies','other'))
  )
);
create index if not exists travel_advance_lines_adv_idx on public.travel_advance_lines(advance_id);

insert into public.ref_counters(kind, prefix, n) values ('ADV', 'ADV-00', 0) on conflict (kind) do nothing;

alter table public.travel_advances enable row level security;
alter table public.travel_advance_lines enable row level security;
drop policy if exists "read travel advances" on public.travel_advances;
drop policy if exists "read travel advance lines" on public.travel_advance_lines;
create policy "read travel advances" on public.travel_advances for select to authenticated using (true);
create policy "read travel advance lines" on public.travel_advance_lines for select to authenticated using (true);

-- ---------- frontend read shape ----------
create or replace function public.tadv_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.ref, 'purpose', a.purpose, 'project', a.project_code, 'amount', a.amount,
    'state', a.state, 'approverRole', a.approver_role,
    'holder', h.name, 'holderEmail', h.email,
    'decidedBy', dc.name, 'decidedAt', a.decided_at, 'note', a.decision_note,
    'issuedBy', ib.name, 'issuedAt', a.issued_at, 'issueRef', a.issue_ref,
    'spent', a.spent_amount, 'balance', a.balance, 'reconciledAt', a.reconciled_at,
    'settledBy', sb.name, 'settledAt', a.settled_at, 'settleNote', a.settle_note,
    'createdAt', a.created_at,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'category', l.category, 'detail', l.detail, 'amount', l.amount,
        'receiptPath', l.receipt_path, 'isPerDiem', l.is_per_diem,
        'perDiemDays', l.per_diem_days, 'perDiemRate', l.per_diem_rate_used
      ) order by l.created_at)
      from public.travel_advance_lines l where l.advance_id = a.id), '[]'::jsonb))
  from public.travel_advances a
  left join public.app_users h  on h.id  = a.holder_id
  left join public.app_users dc on dc.id = a.decided_by
  left join public.app_users ib on ib.id = a.issued_by
  left join public.app_users sb on sb.id = a.settled_by
  where a.ref = p_ref
$$;

-- ---------- write reconciliation lines (replace-in-place), returns the spent total ----------
create or replace function public.advance_write_lines(p_advance_id uuid, p_lines jsonb, p_rate numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare ln jsonb; v_amt numeric; v_total numeric := 0; v_days int; v_cat text; v_rate numeric;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one line to account for the advance';
  end if;
  delete from public.travel_advance_lines where advance_id = p_advance_id;
  for ln in select value from jsonb_array_elements(p_lines) loop
    if coalesce((ln->>'isPerDiem')::boolean, false) then
      v_days := coalesce((ln->>'perDiemDays')::int, 0);
      if v_days <= 0 then raise exception 'Per-diem days must be greater than zero'; end if;
      v_rate := coalesce(nullif(ln->>'perDiemRate','')::numeric, p_rate, 0);
      if v_rate <= 0 then raise exception 'Enter a per-diem rate per day greater than zero'; end if;
      v_amt := v_days * v_rate;
      insert into public.travel_advance_lines(advance_id, category, detail, amount, is_per_diem, per_diem_days, per_diem_rate_used)
      values (p_advance_id, 'per_diem', nullif(trim(coalesce(ln->>'detail','')),''), v_amt, true, v_days, v_rate);
    else
      v_amt := coalesce((ln->>'amount')::numeric, 0);
      if v_amt <= 0 then raise exception 'Each spent line needs an amount greater than zero'; end if;
      v_cat := nullif(trim(coalesce(ln->>'category','')),'');
      if v_cat is null or v_cat not in ('transport','accommodation','meals','airtime','supplies','other') then
        raise exception 'Choose a category for each spent line';
      end if;
      insert into public.travel_advance_lines(advance_id, category, detail, amount, receipt_path, is_per_diem)
      values (p_advance_id, v_cat, nullif(trim(coalesce(ln->>'detail','')),''), v_amt,
              nullif(trim(coalesce(ln->>'receiptPath','')),''), false);
    end if;
    v_total := v_total + v_amt;
  end loop;
  return v_total;
end $$;

-- ---------- accrue a RECONCILED advance's spent amount into its project's actuals ----------
-- One project_expense per advance, keyed by ref (idempotent). Fires only after reconcile,
-- so an issued-but-unreconciled advance never shows as project cost.
create or replace function public.adv_accrue(p_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare a record; v_project uuid;
begin
  select * into a from public.travel_advances where ref = p_ref;
  if not found or a.state not in ('reconciled','settled') or coalesce(a.spent_amount,0) <= 0
     or nullif(trim(coalesce(a.project_code,'')),'') is null then return; end if;
  select id into v_project from public.projects where name = a.project_code;
  if v_project is null then return; end if;
  if exists (select 1 from public.project_expenses where project_id = v_project and description like 'Advance ' || p_ref || ' %') then return; end if;
  insert into public.project_expenses(project_id, description, amount, spent_on, added_by)
  values (v_project, 'Advance ' || p_ref || ' — ' || a.purpose, a.spent_amount,
          coalesce(a.reconciled_at::date, current_date), coalesce(a.holder_name, 'Travel advance'));
  perform public.recompute_project_money(v_project);
end $$;

-- ---------- request (staff) ----------
create or replace function public.submit_travel_advance(p_purpose text, p_project_code text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_name text; v_email text;
  v_is_super boolean; v_is_hr boolean;
  v_role text; v_mod text; v_lvl int; v_emails jsonb;
  v_project text := nullif(trim(coalesce(p_project_code, '')), '');
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_purpose, '')), '') is null then raise exception 'What is the advance for? A purpose is required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an advance amount greater than zero'; end if;
  select name, email into v_name, v_email from public.app_users where id = v_me;

  v_is_super := exists (select 1 from public.user_permissions p where p.email = lower(v_email) and p.module = 'users' and p.level >= 3);
  v_is_hr    := exists (select 1 from public.user_permissions p where p.email = lower(v_email) and p.module = 'hr'    and p.level >= 2);

  v_ref := public.next_ref('ADV');
  insert into public.travel_advances(ref, entity_id, holder_id, holder_name, purpose, project_code, amount, approver_role, state,
                                     decided_by, decided_at, decision_note)
  values (v_ref, v_entity, v_me, v_name, trim(p_purpose), v_project, p_amount,
          case when v_is_super then 'auto' when v_is_hr then 'super' else 'hr' end,
          case when v_is_super then 'approved' else 'pending' end,
          case when v_is_super then v_me else null end,
          case when v_is_super then now() else null end,
          case when v_is_super then 'Auto-approved — raised by a Super Admin' else null end);

  perform public.audit_write('travel_advance.requested', 'travel_advance', v_ref,
    jsonb_build_object('purpose', p_purpose, 'amount', p_amount, 'project', v_project));

  if v_is_super then
    -- approved on submit, but Finance still issues the cash
    return public.tadv_json(v_ref) || jsonb_build_object('autoApproved', true, 'approverRole', 'auto', 'approverEmails', '[]'::jsonb);
  end if;

  v_role := case when v_is_hr then 'super' else 'hr' end;
  v_mod  := case when v_role = 'super' then 'users' else 'hr' end;
  v_lvl  := case when v_role = 'super' then 3 else 2 end;

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'travel_advance_request',
         v_name || ' requested a travel advance',
         trim(p_purpose) || ' — KES ' || to_char(p_amount, 'FM999,999,990'), 'finance', v_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  select coalesce(jsonb_agg(distinct lower(u.email)), '[]'::jsonb) into v_emails
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  return public.tadv_json(v_ref) || jsonb_build_object('approverRole', v_role, 'approverEmails', v_emails);
end $$;

-- ---------- edit (holder; pending OR rejected → reopens) ----------
create or replace function public.edit_travel_advance(p_ref text, p_purpose text, p_project_code text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  a record; v_reopened boolean; v_role text; v_mod text; v_lvl int; v_emails jsonb; v_name text; v_email text;
begin
  select * into a from public.travel_advances where ref = p_ref;
  if not found then raise exception 'Advance not found'; end if;
  if v_me is null or a.holder_id <> v_me then raise exception 'This is not your advance'; end if;
  if a.state not in ('pending','rejected') then raise exception 'Only a pending or rejected advance can be edited'; end if;
  if nullif(trim(coalesce(p_purpose, '')), '') is null then raise exception 'A purpose is required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an advance amount greater than zero'; end if;
  v_reopened := (a.state = 'rejected');

  update public.travel_advances
    set purpose = trim(p_purpose), project_code = nullif(trim(coalesce(p_project_code, '')), ''),
        amount = p_amount, updated_at = now()
    where ref = p_ref;
  perform public.audit_write('travel_advance.edited', 'travel_advance', p_ref,
    jsonb_build_object('purpose', p_purpose, 'amount', p_amount, 'reopened', v_reopened));

  if not v_reopened then return public.tadv_json(p_ref); end if;

  update public.travel_advances
    set state = 'pending', decided_by = null, decided_at = null, decision_note = null, updated_at = now()
    where ref = p_ref;
  v_role := coalesce(a.approver_role, 'hr');
  v_mod  := case when v_role = 'super' then 'users' else 'hr' end;
  v_lvl  := case when v_role = 'super' then 3 else 2 end;
  select name, email into v_name, v_email from public.app_users where id = v_me;

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'travel_advance_request',
         v_name || ' updated a rejected advance',
         trim(p_purpose) || ' — KES ' || to_char(p_amount, 'FM999,999,990'), 'finance', p_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  select coalesce(jsonb_agg(distinct lower(u.email)), '[]'::jsonb) into v_emails
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  return public.tadv_json(p_ref) || jsonb_build_object('reopened', true, 'approverRole', v_role, 'approverEmails', v_emails);
end $$;

-- ---------- withdraw (holder; pending or rejected) ----------
create or replace function public.delete_travel_advance(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); a record;
begin
  select * into a from public.travel_advances where ref = p_ref;
  if not found then raise exception 'Advance not found'; end if;
  if v_me is null or a.holder_id <> v_me then raise exception 'This is not your advance'; end if;
  if a.state not in ('pending','rejected') then raise exception 'Only a pending or rejected advance can be withdrawn'; end if;
  delete from public.travel_advances where ref = p_ref;
  perform public.audit_write('travel_advance.withdrawn', 'travel_advance', p_ref, '{}'::jsonb);
  return jsonb_build_object('id', p_ref, 'deleted', true);
end $$;

-- ---------- decide (routed role; holder ≠ approver) ----------
create or replace function public.decide_travel_advance(p_ref text, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_is_super boolean := public.can_petty_super();
  v_is_hr boolean := public.can_petty_hr();
  a record; v_ok boolean;
begin
  if not (v_is_super or v_is_hr) then raise exception 'Only a Super Admin or HR can decide travel advances'; end if;
  select * into a from public.travel_advances where ref = p_ref;
  if not found then raise exception 'Advance not found'; end if;
  if a.state <> 'pending' then raise exception 'This advance was already decided'; end if;
  if a.holder_id = v_me then raise exception 'You cannot decide your own advance'; end if;

  v_ok := case
    when a.approver_role = 'super' then v_is_super
    when a.approver_role = 'hr' then v_is_hr
    else (v_is_super or v_is_hr)
  end;
  if not v_ok then
    raise exception '%', case when a.approver_role = 'super'
      then 'This advance is awaiting Super Admin approval'
      else 'This advance is awaiting HR approval' end;
  end if;

  update public.travel_advances
    set state = case when p_approve then 'approved' else 'rejected' end,
        decided_by = v_me, decided_at = now(),
        decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
    where ref = p_ref;

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  values (v_entity, lower((select email from public.app_users where id = a.holder_id)),
          'travel_advance_decided',
          case when p_approve then 'Travel advance approved' else 'Travel advance rejected' end,
          a.purpose || ' — KES ' || to_char(a.amount, 'FM999,999,990') ||
            case when p_note is not null and trim(p_note) <> '' then ' · ' || trim(p_note) else '' end,
          'staffportal', p_ref);
  perform public.audit_write(case when p_approve then 'travel_advance.approved' else 'travel_advance.rejected' end,
    'travel_advance', p_ref, jsonb_build_object('amount', a.amount, 'note', p_note));

  return public.tadv_json(p_ref);
end $$;

-- ---------- issue (Finance pays the cash; becomes an open receivable — NOT project cost) ----------
create or replace function public.issue_travel_advance(p_ref text, p_issue_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  a record;
begin
  perform public.assert_access('finance', 2);
  select * into a from public.travel_advances where ref = p_ref;
  if not found then raise exception 'Advance not found'; end if;
  if a.state <> 'approved' then raise exception 'Only an approved advance can be issued'; end if;

  update public.travel_advances
    set state = 'issued', issued_by = v_me, issued_at = now(),
        issue_ref = nullif(trim(coalesce(p_issue_ref, '')), ''), updated_at = now()
    where ref = p_ref;

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  values (v_entity, lower((select email from public.app_users where id = a.holder_id)),
          'travel_advance_issued', 'Travel advance issued',
          a.purpose || ' — KES ' || to_char(a.amount, 'FM999,999,990') || ' issued. Reconcile it with receipts on your return.',
          'staffportal', p_ref);
  perform public.audit_write('travel_advance.issued', 'travel_advance', p_ref,
    jsonb_build_object('amount', a.amount, 'issueRef', p_issue_ref));

  return public.tadv_json(p_ref);
end $$;

-- ---------- reconcile (holder accounts for the advance; posts spent to the project) ----------
create or replace function public.reconcile_travel_advance(p_ref text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_is_fin boolean := exists (
    select 1 from public.user_permissions p
    join public.app_users u on lower(u.email) = p.email
    where u.auth_id = auth.uid() and p.module = 'finance' and p.level >= 2);
  a record; v_rate numeric := public.per_diem_rate(); v_spent numeric;
begin
  select * into a from public.travel_advances where ref = p_ref;
  if not found then raise exception 'Advance not found'; end if;
  -- the holder accounts for their own advance; Finance may also do it on their behalf
  if not (a.holder_id = v_me or v_is_fin) then raise exception 'Only the holder or Finance can reconcile this advance'; end if;
  if a.state <> 'issued' then raise exception 'Only an issued advance can be reconciled'; end if;

  v_spent := public.advance_write_lines(a.id, p_lines, v_rate);
  update public.travel_advances
    set state = 'reconciled', spent_amount = v_spent, balance = a.amount - v_spent,
        reconciled_at = now(), updated_at = now()
    where ref = p_ref;

  perform public.adv_accrue(p_ref);   -- only the reconciled amount hits the project

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'travel_advance_reconciled',
         coalesce(a.holder_name,'A holder') || ' reconciled a travel advance',
         a.purpose || ' — spent KES ' || to_char(v_spent, 'FM999,999,990') ||
           ', balance KES ' || to_char(a.amount - v_spent, 'FM999,999,990'), 'finance', p_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = 'finance' and p.level >= 2;
  perform public.audit_write('travel_advance.reconciled', 'travel_advance', p_ref,
    jsonb_build_object('spent', v_spent, 'balance', a.amount - v_spent));

  return public.tadv_json(p_ref);
end $$;

-- ---------- settle (Finance clears the balance: holder returns underspend / is topped up) ----------
create or replace function public.settle_travel_advance(p_ref text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  a record;
begin
  perform public.assert_access('finance', 2);
  select * into a from public.travel_advances where ref = p_ref;
  if not found then raise exception 'Advance not found'; end if;
  if a.state <> 'reconciled' then raise exception 'Only a reconciled advance can be settled'; end if;

  update public.travel_advances
    set state = 'settled', settled_by = v_me, settled_at = now(),
        settle_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
    where ref = p_ref;

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  values (v_entity, lower((select email from public.app_users where id = a.holder_id)),
          'travel_advance_settled', 'Travel advance settled',
          a.purpose || ' — balance KES ' || to_char(coalesce(a.balance,0), 'FM999,999,990') ||
            case when coalesce(a.balance,0) > 0 then ' returned' when coalesce(a.balance,0) < 0 then ' topped up' else ' cleared' end,
          'staffportal', p_ref);
  perform public.audit_write('travel_advance.settled', 'travel_advance', p_ref,
    jsonb_build_object('balance', a.balance, 'note', p_note));

  return public.tadv_json(p_ref);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'submit_travel_advance(text,text,numeric)',
    'edit_travel_advance(text,text,text,numeric)',
    'delete_travel_advance(text)',
    'decide_travel_advance(text,boolean,text)',
    'issue_travel_advance(text,text)',
    'reconcile_travel_advance(text,jsonb)',
    'settle_travel_advance(text,text)',
    'adv_accrue(text)',
    'advance_write_lines(uuid,jsonb,numeric)',
    'tadv_json(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  execute 'grant execute on function public.adv_accrue(text) to service_role';
end $$;
