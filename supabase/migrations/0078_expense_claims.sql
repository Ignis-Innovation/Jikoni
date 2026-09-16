-- ============================================================
-- 0078 — Expenses & Claims (Phase 1: reimbursement claims)
-- A staff member spends their OWN money and is owed back. Not petty cash (that's a
-- matatu fare), not procurement (that's an office-paid invoice) — the staff-money door.
-- This is NOT a new module: it's a feature inside Finance that reuses the petty-cash
-- spine — submit-from-portal → role-routed approval → claimant-can't-approve-own → on
-- approval accrue to the tied project's actuals (project_expenses + recompute_project_money).
--
-- A claim carries LINES: each a receipted expense (category + receipt + amount) or a
-- computed per-diem line (days × a configured rate, no receipt). Approved claims accrue
-- one project_expense for the total. Reimbursement is DONE only when Finance marks it paid
-- (a state after approved) — it does not re-accrue. Idempotent throughout.
--
-- Reuses: next_ref, audit_write, assert_access (editor hard-lock, 0073), notifications,
-- can_petty_super()/can_petty_hr() (0053), project_expenses + recompute_project_money (0072).
-- ============================================================

-- ---------- schema ----------
create table if not exists public.expense_claims (
  id             uuid primary key default gen_random_uuid(),
  ref            text unique not null,
  entity_id      uuid references public.entities(id),
  requester_id   uuid references public.app_users(id),
  requester_name text,
  purpose        text not null,
  project_code   text,
  total_amount   numeric(14,2) not null default 0 check (total_amount >= 0),
  approver_role  text,                 -- 'hr' | 'super' | 'auto'
  state          text not null default 'pending'
                   check (state in ('pending','approved','rejected','paid','cancelled')),
  decided_by     uuid references public.app_users(id),
  decided_at     timestamptz,
  decision_note  text,
  paid_by        uuid references public.app_users(id),
  paid_at        timestamptz,
  payment_ref    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.expense_claim_lines (
  id                 uuid primary key default gen_random_uuid(),
  claim_id           uuid not null references public.expense_claims(id) on delete cascade,
  category           text not null,
  detail             text,
  amount             numeric(14,2) not null default 0 check (amount >= 0),
  receipt_path       text,
  is_per_diem        boolean not null default false,
  per_diem_days      int,
  per_diem_rate_used numeric(14,2),     -- snapshot of the config rate at submit/edit time
  created_at         timestamptz not null default now(),
  -- a per-diem line is 'per_diem'; a receipted line is one of the fixed reporting categories
  constraint expense_claim_lines_category_ck check (
    (is_per_diem and category = 'per_diem') or
    (not is_per_diem and category in ('transport','accommodation','meals','airtime','supplies','other'))
  )
);
create index if not exists expense_claim_lines_claim_idx on public.expense_claim_lines(claim_id);

-- ref counter for CLM-001, CLM-002, …
insert into public.ref_counters(kind, prefix, n) values ('CLM', 'CLM-00', 0) on conflict (kind) do nothing;

alter table public.expense_claims enable row level security;
alter table public.expense_claim_lines enable row level security;
drop policy if exists "read expense claims" on public.expense_claims;
drop policy if exists "read expense claim lines" on public.expense_claim_lines;
-- readable by any signed-in user (same model as petty cash); the Staff Portal shows the
-- caller's own rows, the Finance → Claims tab shows the queue.
create policy "read expense claims" on public.expense_claims for select to authenticated using (true);
create policy "read expense claim lines" on public.expense_claim_lines for select to authenticated using (true);

-- ---------- per-diem rate (config, not code) ----------
-- Extend the set_app_config allowlist with per_diem_daily_rate and seed a default.
create or replace function public.set_app_config(p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_access('users', 2);
  if p_key not in (
    'match_tolerance_pct','po_amend_tolerance_pct','manual_journal_threshold',
    'reminder_hours','escalation_hours','enforce_sod','enforce_access',
    'org_legal_name','primary_entity','base_currency','fiscal_year_start',
    'notif_in_app','notif_email_digest','notif_sms_overdue','notif_stalled_eng',
    'approve_auto_below','single_approver_max','dual_approval_max','md_signoff_above',
    'require_2fa','dataroom_mode',
    'integ_mpesa','integ_etims','integ_email','integ_sms','integ_claude','integ_ura',
    'per_diem_daily_rate'
  ) then
    raise exception 'Unknown setting: %', p_key;
  end if;
  insert into public.app_config(key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit_write('config.updated','app_config', p_key, jsonb_build_object('value', p_value));
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

insert into public.app_config(key, value) values ('per_diem_daily_rate', '5000'::jsonb)
on conflict (key) do nothing;

-- read the current per-diem daily rate (0 if unset)
create or replace function public.per_diem_rate() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::numeric from public.app_config where key = 'per_diem_daily_rate'), 0)
$$;

-- ---------- frontend read shape ----------
create or replace function public.cej_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.ref, 'purpose', c.purpose, 'project', c.project_code,
    'total', c.total_amount, 'state', c.state, 'approverRole', c.approver_role,
    'requester', rq.name, 'requesterEmail', rq.email,
    'decidedBy', dc.name, 'decidedAt', c.decided_at, 'note', c.decision_note,
    'paidBy', pb.name, 'paidAt', c.paid_at, 'paymentRef', c.payment_ref,
    'createdAt', c.created_at,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'category', l.category, 'detail', l.detail, 'amount', l.amount,
        'receiptPath', l.receipt_path, 'isPerDiem', l.is_per_diem,
        'perDiemDays', l.per_diem_days, 'perDiemRate', l.per_diem_rate_used
      ) order by l.created_at)
      from public.expense_claim_lines l where l.claim_id = c.id), '[]'::jsonb))
  from public.expense_claims c
  left join public.app_users rq on rq.id = c.requester_id
  left join public.app_users dc on dc.id = c.decided_by
  left join public.app_users pb on pb.id = c.paid_by
  where c.ref = p_ref
$$;

-- ---------- write the lines for a claim (replace-in-place), returns the total ----------
-- Per-diem lines are computed server-side (days × rate) and never trust a client amount.
-- Receipts are NOT required here — a receipted line may be filed with a null receipt and
-- attached later (field staff on bad connectivity file first, attach on return).
create or replace function public.claim_write_lines(p_claim_id uuid, p_lines jsonb, p_rate numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare ln jsonb; v_amt numeric; v_total numeric := 0; v_days int; v_cat text; v_rate numeric;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one line to the claim';
  end if;
  delete from public.expense_claim_lines where claim_id = p_claim_id;
  for ln in select value from jsonb_array_elements(p_lines) loop
    if coalesce((ln->>'isPerDiem')::boolean, false) then
      v_days := coalesce((ln->>'perDiemDays')::int, 0);
      if v_days <= 0 then raise exception 'Per-diem days must be greater than zero'; end if;
      -- the daily rate can be typed on the claim; fall back to the configured rate
      v_rate := coalesce(nullif(ln->>'perDiemRate','')::numeric, p_rate, 0);
      if v_rate <= 0 then raise exception 'Enter a per-diem rate per day greater than zero'; end if;
      v_amt := v_days * v_rate;
      insert into public.expense_claim_lines(claim_id, category, detail, amount, is_per_diem, per_diem_days, per_diem_rate_used)
      values (p_claim_id, 'per_diem', nullif(trim(coalesce(ln->>'detail','')),''), v_amt, true, v_days, v_rate);
    else
      v_amt := coalesce((ln->>'amount')::numeric, 0);
      if v_amt <= 0 then raise exception 'Each expense line needs an amount greater than zero'; end if;
      v_cat := nullif(trim(coalesce(ln->>'category','')),'');
      if v_cat is null or v_cat not in ('transport','accommodation','meals','airtime','supplies','other') then
        raise exception 'Choose a category for each expense line';
      end if;
      insert into public.expense_claim_lines(claim_id, category, detail, amount, receipt_path, is_per_diem)
      values (p_claim_id, v_cat, nullif(trim(coalesce(ln->>'detail','')),''), v_amt,
              nullif(trim(coalesce(ln->>'receiptPath','')),''), false);
    end if;
    v_total := v_total + v_amt;
  end loop;
  return v_total;
end $$;

-- ---------- accrue an APPROVED claim into its project's actuals ----------
-- One project_expense per claim, keyed by ref (idempotent) — direct analogue of pcr_accrue.
create or replace function public.claim_accrue(p_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_project uuid;
begin
  select * into r from public.expense_claims where ref = p_ref;
  if not found or r.state not in ('approved','paid') or nullif(trim(coalesce(r.project_code,'')),'') is null then return; end if;
  select id into v_project from public.projects where name = r.project_code;
  if v_project is null then return; end if;
  if exists (select 1 from public.project_expenses where project_id = v_project and description like 'Claim ' || p_ref || ' %') then return; end if;
  insert into public.project_expenses(project_id, description, amount, spent_on, added_by)
  values (v_project, 'Claim ' || p_ref || ' — ' || r.purpose, r.total_amount,
          coalesce(r.decided_at::date, current_date), coalesce(r.requester_name, 'Expense claim'));
  perform public.recompute_project_money(v_project);
end $$;

-- ---------- submit (staff) ----------
create or replace function public.submit_expense_claim(p_purpose text, p_project_code text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_name text; v_email text;
  v_is_super boolean; v_is_hr boolean;
  v_role text; v_mod text; v_lvl int; v_emails jsonb;
  v_project text := nullif(trim(coalesce(p_project_code, '')), '');
  v_rate numeric := public.per_diem_rate();
  v_total numeric; v_claim uuid;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_purpose, '')), '') is null then raise exception 'What is this claim for? A purpose is required'; end if;
  select name, email into v_name, v_email from public.app_users where id = v_me;

  v_is_super := exists (select 1 from public.user_permissions p where p.email = lower(v_email) and p.module = 'users' and p.level >= 3);
  v_is_hr    := exists (select 1 from public.user_permissions p where p.email = lower(v_email) and p.module = 'hr'    and p.level >= 2);

  v_ref := public.next_ref('CLM');
  insert into public.expense_claims(ref, entity_id, requester_id, requester_name, purpose, project_code, approver_role, state,
                                    decided_by, decided_at, decision_note)
  values (v_ref, v_entity, v_me, v_name, trim(p_purpose), v_project,
          case when v_is_super then 'auto' when v_is_hr then 'super' else 'hr' end,
          case when v_is_super then 'approved' else 'pending' end,
          case when v_is_super then v_me else null end,
          case when v_is_super then now() else null end,
          case when v_is_super then 'Auto-approved — raised by a Super Admin' else null end)
  returning id into v_claim;

  v_total := public.claim_write_lines(v_claim, p_lines, v_rate);
  update public.expense_claims set total_amount = v_total where id = v_claim;

  perform public.audit_write('expense_claim.requested', 'expense_claim', v_ref,
    jsonb_build_object('purpose', p_purpose, 'total', v_total, 'project', v_project));

  -- a Super Admin's own claim is auto-approved on submit → accrue immediately
  if v_is_super then
    perform public.claim_accrue(v_ref);
    perform public.audit_write('expense_claim.approved', 'expense_claim', v_ref,
      jsonb_build_object('total', v_total, 'auto', true));
    return public.cej_json(v_ref) || jsonb_build_object('autoApproved', true, 'approverRole', 'auto', 'approverEmails', '[]'::jsonb);
  end if;

  v_role := case when v_is_hr then 'super' else 'hr' end;   -- HR's own → Super Admin; everyone else → HR
  v_mod  := case when v_role = 'super' then 'users' else 'hr' end;
  v_lvl  := case when v_role = 'super' then 3 else 2 end;

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'expense_claim_request',
         v_name || ' filed an expense claim',
         trim(p_purpose) || ' — KES ' || to_char(v_total, 'FM999,999,990'), 'finance', v_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  select coalesce(jsonb_agg(distinct lower(u.email)), '[]'::jsonb) into v_emails
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  return public.cej_json(v_ref) || jsonb_build_object('approverRole', v_role, 'approverEmails', v_emails);
end $$;

-- ---------- edit (owner; pending OR rejected → editing a rejected claim reopens it) ----------
create or replace function public.edit_expense_claim(p_ref text, p_purpose text, p_project_code text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  r record; v_rate numeric := public.per_diem_rate(); v_total numeric;
  v_reopened boolean; v_role text; v_mod text; v_lvl int; v_emails jsonb; v_name text; v_email text;
begin
  select * into r from public.expense_claims where ref = p_ref;
  if not found then raise exception 'Claim not found'; end if;
  if v_me is null or r.requester_id <> v_me then raise exception 'This is not your claim'; end if;
  if r.state not in ('pending','rejected') then raise exception 'Only a pending or rejected claim can be edited'; end if;
  if nullif(trim(coalesce(p_purpose, '')), '') is null then raise exception 'A purpose is required'; end if;
  v_reopened := (r.state = 'rejected');

  update public.expense_claims
    set purpose = trim(p_purpose), project_code = nullif(trim(coalesce(p_project_code, '')), ''), updated_at = now()
    where ref = p_ref;
  v_total := public.claim_write_lines(r.id, p_lines, v_rate);
  update public.expense_claims set total_amount = v_total where ref = p_ref;

  perform public.audit_write('expense_claim.edited', 'expense_claim', p_ref,
    jsonb_build_object('purpose', p_purpose, 'total', v_total, 'reopened', v_reopened));

  if not v_reopened then
    return public.cej_json(p_ref);
  end if;

  -- editing a rejected claim sends it back to pending and re-notifies the approver
  update public.expense_claims
    set state = 'pending', decided_by = null, decided_at = null, decision_note = null, updated_at = now()
    where ref = p_ref;
  v_role := coalesce(r.approver_role, 'hr');
  v_mod  := case when v_role = 'super' then 'users' else 'hr' end;
  v_lvl  := case when v_role = 'super' then 3 else 2 end;
  select name, email into v_name, v_email from public.app_users where id = v_me;

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'expense_claim_request',
         v_name || ' updated a rejected claim',
         trim(p_purpose) || ' — KES ' || to_char(v_total, 'FM999,999,990'), 'finance', p_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  select coalesce(jsonb_agg(distinct lower(u.email)), '[]'::jsonb) into v_emails
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  return public.cej_json(p_ref) || jsonb_build_object('reopened', true, 'approverRole', v_role, 'approverEmails', v_emails);
end $$;

-- ---------- withdraw (owner; pending or rejected) ----------
create or replace function public.delete_expense_claim(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); r record;
begin
  select * into r from public.expense_claims where ref = p_ref;
  if not found then raise exception 'Claim not found'; end if;
  if v_me is null or r.requester_id <> v_me then raise exception 'This is not your claim'; end if;
  if r.state not in ('pending','rejected') then raise exception 'Only a pending or rejected claim can be withdrawn'; end if;
  delete from public.expense_claims where ref = p_ref;
  perform public.audit_write('expense_claim.withdrawn', 'expense_claim', p_ref, '{}'::jsonb);
  return jsonb_build_object('id', p_ref, 'deleted', true);
end $$;

-- ---------- attach a receipt to a line (owner; while pending or rejected) ----------
create or replace function public.attach_claim_receipt(p_line_id uuid, p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); r record;
begin
  select c.* into r from public.expense_claims c
    join public.expense_claim_lines l on l.claim_id = c.id where l.id = p_line_id;
  if not found then raise exception 'Line not found'; end if;
  if v_me is null or r.requester_id <> v_me then raise exception 'This is not your claim'; end if;
  if r.state not in ('pending','rejected') then raise exception 'You can only attach receipts while the claim is pending'; end if;
  update public.expense_claim_lines set receipt_path = nullif(trim(coalesce(p_path, '')), '') where id = p_line_id;
  perform public.audit_write('expense_claim.receipt', 'expense_claim', r.ref, jsonb_build_object('line', p_line_id));
  return public.cej_json(r.ref);
end $$;

-- ---------- decide (routed role; claimant ≠ approver) ----------
create or replace function public.decide_expense_claim(p_ref text, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_is_super boolean := public.can_petty_super();
  v_is_hr boolean := public.can_petty_hr();
  r record; v_ok boolean;
begin
  if not (v_is_super or v_is_hr) then raise exception 'Only a Super Admin or HR can decide expense claims'; end if;
  select * into r from public.expense_claims where ref = p_ref;
  if not found then raise exception 'Claim not found'; end if;
  if r.state <> 'pending' then raise exception 'This claim was already decided'; end if;
  if r.requester_id = v_me then raise exception 'You cannot decide your own claim'; end if;

  v_ok := case
    when r.approver_role = 'super' then v_is_super
    when r.approver_role = 'hr' then v_is_hr
    else (v_is_super or v_is_hr)
  end;
  if not v_ok then
    raise exception '%', case when r.approver_role = 'super'
      then 'This claim is awaiting Super Admin approval'
      else 'This claim is awaiting HR approval' end;
  end if;

  -- the receipt requirement lives HERE, not at submit: no approval with a receiptless expense line
  if p_approve and exists (
    select 1 from public.expense_claim_lines
    where claim_id = r.id and not is_per_diem and nullif(trim(coalesce(receipt_path, '')), '') is null
  ) then
    raise exception 'Every expense line needs a receipt attached before this claim can be approved';
  end if;

  update public.expense_claims
    set state = case when p_approve then 'approved' else 'rejected' end,
        decided_by = v_me, decided_at = now(),
        decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
    where ref = p_ref;

  if p_approve then perform public.claim_accrue(p_ref); end if;

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  values (v_entity, lower((select email from public.app_users where id = r.requester_id)),
          'expense_claim_decided',
          case when p_approve then 'Expense claim approved' else 'Expense claim rejected' end,
          r.purpose || ' — KES ' || to_char(r.total_amount, 'FM999,999,990') ||
            case when p_note is not null and trim(p_note) <> '' then ' · ' || trim(p_note) else '' end,
          'staffportal', p_ref);
  perform public.audit_write(case when p_approve then 'expense_claim.approved' else 'expense_claim.rejected' end,
    'expense_claim', p_ref, jsonb_build_object('total', r.total_amount, 'note', p_note));

  return public.cej_json(p_ref);
end $$;

-- ---------- mark paid (Finance only; a state after approved — does NOT re-accrue) ----------
create or replace function public.mark_claim_paid(p_ref text, p_payment_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  r record;
begin
  perform public.assert_access('finance', 2);   -- Finance action; honours the editor hard-lock
  select * into r from public.expense_claims where ref = p_ref;
  if not found then raise exception 'Claim not found'; end if;
  if r.state = 'paid' then raise exception 'This claim is already marked paid'; end if;
  if r.state <> 'approved' then raise exception 'Only an approved claim can be marked paid'; end if;

  update public.expense_claims
    set state = 'paid', paid_by = v_me, paid_at = now(),
        payment_ref = nullif(trim(coalesce(p_payment_ref, '')), ''), updated_at = now()
    where ref = p_ref;

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  values (v_entity, lower((select email from public.app_users where id = r.requester_id)),
          'expense_claim_paid', 'Reimbursement paid',
          r.purpose || ' — KES ' || to_char(r.total_amount, 'FM999,999,990') || ' has been reimbursed',
          'staffportal', p_ref);
  perform public.audit_write('expense_claim.paid', 'expense_claim', p_ref,
    jsonb_build_object('total', r.total_amount, 'paymentRef', p_payment_ref));

  return public.cej_json(p_ref);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'submit_expense_claim(text,text,jsonb)',
    'edit_expense_claim(text,text,text,jsonb)',
    'delete_expense_claim(text)',
    'attach_claim_receipt(uuid,text)',
    'decide_expense_claim(text,boolean,text)',
    'mark_claim_paid(text,text)',
    'claim_accrue(text)',
    'claim_write_lines(uuid,jsonb,numeric)',
    'per_diem_rate()',
    'cej_json(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  -- claim_accrue is also called by service_role paths, mirror pcr_accrue
  execute 'grant execute on function public.claim_accrue(text) to service_role';
end $$;
