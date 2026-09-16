-- ============================================================
-- 0081 — Two refinements to Expenses & Claims:
--   (1) Travel-advance requests are BUILT FROM LINES (like a claim). The requested amount
--       is the sum of "planned" estimate lines (fuel + hotel + per-diem …), so HR sees how
--       the total was reached. Planned lines (is_estimate=true) are kept separate from the
--       "actual" reconciliation lines (is_estimate=false) so reconciling never wipes the plan.
--   (2) An expense claim can optionally LINK to a travel advance (advance_code) — the
--       "the advance wasn't enough, I paid the extra myself" case. Informational link only;
--       it does not change any posting.
-- Idempotent (create-or-replace + add-column-if-not-exists).
-- ============================================================

-- ---------- Part 1: planned vs actual lines on advances ----------
alter table public.travel_advance_lines add column if not exists is_estimate boolean not null default false;

-- amount is now derived (sum of planned lines) — allow a transient 0 at insert time.
alter table public.travel_advances alter column amount set default 0;
alter table public.travel_advances drop constraint if exists travel_advances_amount_check;
alter table public.travel_advances add constraint travel_advances_amount_check check (amount >= 0);

-- write lines of ONE kind (planned or actual); returns the total. Scoped delete/insert by
-- is_estimate so the two kinds never clobber each other.
drop function if exists public.advance_write_lines(uuid, jsonb, numeric);
create or replace function public.advance_write_lines(p_advance_id uuid, p_lines jsonb, p_rate numeric, p_is_estimate boolean)
returns numeric language plpgsql security definer set search_path = public as $$
declare ln jsonb; v_amt numeric; v_total numeric := 0; v_days int; v_cat text; v_rate numeric;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception '%', case when p_is_estimate then 'Add at least one line to build up the advance amount' else 'Add at least one line to account for the advance' end;
  end if;
  delete from public.travel_advance_lines where advance_id = p_advance_id and is_estimate = p_is_estimate;
  for ln in select value from jsonb_array_elements(p_lines) loop
    if coalesce((ln->>'isPerDiem')::boolean, false) then
      v_days := coalesce((ln->>'perDiemDays')::int, 0);
      if v_days <= 0 then raise exception 'Per-diem days must be greater than zero'; end if;
      v_rate := coalesce(nullif(ln->>'perDiemRate','')::numeric, p_rate, 0);
      if v_rate <= 0 then raise exception 'Enter a per-diem rate per day greater than zero'; end if;
      v_amt := v_days * v_rate;
      insert into public.travel_advance_lines(advance_id, category, detail, amount, is_per_diem, per_diem_days, per_diem_rate_used, is_estimate)
      values (p_advance_id, 'per_diem', nullif(trim(coalesce(ln->>'detail','')),''), v_amt, true, v_days, v_rate, p_is_estimate);
    else
      v_amt := coalesce((ln->>'amount')::numeric, 0);
      if v_amt <= 0 then raise exception 'Each line needs an amount greater than zero'; end if;
      v_cat := nullif(trim(coalesce(ln->>'category','')),'');
      if v_cat is null or v_cat not in ('transport','accommodation','meals','airtime','supplies','other') then
        raise exception 'Choose a category for each line';
      end if;
      insert into public.travel_advance_lines(advance_id, category, detail, amount, receipt_path, is_per_diem, is_estimate)
      values (p_advance_id, v_cat, nullif(trim(coalesce(ln->>'detail','')),''), v_amt,
              nullif(trim(coalesce(ln->>'receiptPath','')),''), false, p_is_estimate);
    end if;
    v_total := v_total + v_amt;
  end loop;
  return v_total;
end $$;

-- read shape: planned (estimate) lines separate from actual reconciliation lines
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
    'plannedLines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'category', l.category, 'detail', l.detail, 'amount', l.amount,
        'receiptPath', l.receipt_path, 'isPerDiem', l.is_per_diem,
        'perDiemDays', l.per_diem_days, 'perDiemRate', l.per_diem_rate_used
      ) order by l.created_at)
      from public.travel_advance_lines l where l.advance_id = a.id and l.is_estimate), '[]'::jsonb),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'category', l.category, 'detail', l.detail, 'amount', l.amount,
        'receiptPath', l.receipt_path, 'isPerDiem', l.is_per_diem,
        'perDiemDays', l.per_diem_days, 'perDiemRate', l.per_diem_rate_used
      ) order by l.created_at)
      from public.travel_advance_lines l where l.advance_id = a.id and not l.is_estimate), '[]'::jsonb))
  from public.travel_advances a
  left join public.app_users h  on h.id  = a.holder_id
  left join public.app_users dc on dc.id = a.decided_by
  left join public.app_users ib on ib.id = a.issued_by
  left join public.app_users sb on sb.id = a.settled_by
  where a.ref = p_ref
$$;

-- request: the amount is now built from planned lines
drop function if exists public.submit_travel_advance(text, text, numeric);
create or replace function public.submit_travel_advance(p_purpose text, p_project_code text, p_lines jsonb)
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
  v_total numeric; v_adv uuid;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_purpose, '')), '') is null then raise exception 'What is the advance for? A purpose is required'; end if;
  select name, email into v_name, v_email from public.app_users where id = v_me;

  v_is_super := exists (select 1 from public.user_permissions p where p.email = lower(v_email) and p.module = 'users' and p.level >= 3);
  v_is_hr    := exists (select 1 from public.user_permissions p where p.email = lower(v_email) and p.module = 'hr'    and p.level >= 2);

  v_ref := public.next_ref('ADV');
  insert into public.travel_advances(ref, entity_id, holder_id, holder_name, purpose, project_code, approver_role, state,
                                     decided_by, decided_at, decision_note)
  values (v_ref, v_entity, v_me, v_name, trim(p_purpose), v_project,
          case when v_is_super then 'auto' when v_is_hr then 'super' else 'hr' end,
          case when v_is_super then 'approved' else 'pending' end,
          case when v_is_super then v_me else null end,
          case when v_is_super then now() else null end,
          case when v_is_super then 'Auto-approved — raised by a Super Admin' else null end)
  returning id into v_adv;

  v_total := public.advance_write_lines(v_adv, p_lines, v_rate, true);   -- planned lines
  update public.travel_advances set amount = v_total where id = v_adv;

  perform public.audit_write('travel_advance.requested', 'travel_advance', v_ref,
    jsonb_build_object('purpose', p_purpose, 'amount', v_total, 'project', v_project));

  if v_is_super then
    return public.tadv_json(v_ref) || jsonb_build_object('autoApproved', true, 'approverRole', 'auto', 'approverEmails', '[]'::jsonb);
  end if;

  v_role := case when v_is_hr then 'super' else 'hr' end;
  v_mod  := case when v_role = 'super' then 'users' else 'hr' end;
  v_lvl  := case when v_role = 'super' then 3 else 2 end;

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'travel_advance_request',
         v_name || ' requested a travel advance',
         trim(p_purpose) || ' — KES ' || to_char(v_total, 'FM999,999,990'), 'finance', v_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  select coalesce(jsonb_agg(distinct lower(u.email)), '[]'::jsonb) into v_emails
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  return public.tadv_json(v_ref) || jsonb_build_object('approverRole', v_role, 'approverEmails', v_emails);
end $$;

-- edit: rewrite planned lines, recompute amount
drop function if exists public.edit_travel_advance(text, text, text, numeric);
create or replace function public.edit_travel_advance(p_ref text, p_purpose text, p_project_code text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  a record; v_reopened boolean; v_role text; v_mod text; v_lvl int; v_emails jsonb; v_name text; v_email text;
  v_rate numeric := public.per_diem_rate(); v_total numeric;
begin
  select * into a from public.travel_advances where ref = p_ref;
  if not found then raise exception 'Advance not found'; end if;
  if v_me is null or a.holder_id <> v_me then raise exception 'This is not your advance'; end if;
  if a.state not in ('pending','rejected') then raise exception 'Only a pending or rejected advance can be edited'; end if;
  if nullif(trim(coalesce(p_purpose, '')), '') is null then raise exception 'A purpose is required'; end if;
  v_reopened := (a.state = 'rejected');

  update public.travel_advances
    set purpose = trim(p_purpose), project_code = nullif(trim(coalesce(p_project_code, '')), ''), updated_at = now()
    where ref = p_ref;
  v_total := public.advance_write_lines(a.id, p_lines, v_rate, true);
  update public.travel_advances set amount = v_total where ref = p_ref;

  perform public.audit_write('travel_advance.edited', 'travel_advance', p_ref,
    jsonb_build_object('purpose', p_purpose, 'amount', v_total, 'reopened', v_reopened));

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
         trim(p_purpose) || ' — KES ' || to_char(v_total, 'FM999,999,990'), 'finance', p_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  select coalesce(jsonb_agg(distinct lower(u.email)), '[]'::jsonb) into v_emails
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  return public.tadv_json(p_ref) || jsonb_build_object('reopened', true, 'approverRole', v_role, 'approverEmails', v_emails);
end $$;

-- reconcile now writes ACTUAL lines (is_estimate=false), leaving planned lines intact
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
  if not (a.holder_id = v_me or v_is_fin) then raise exception 'Only the holder or Finance can reconcile this advance'; end if;
  if a.state <> 'issued' then raise exception 'Only an issued advance can be reconciled'; end if;

  v_spent := public.advance_write_lines(a.id, p_lines, v_rate, false);   -- actual lines
  update public.travel_advances
    set state = 'reconciled', spent_amount = v_spent, balance = a.amount - v_spent,
        reconciled_at = now(), updated_at = now()
    where ref = p_ref;

  perform public.adv_accrue(p_ref);

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

-- ---------- Part 2: link an expense claim to a travel advance ----------
alter table public.expense_claims add column if not exists advance_code text;

create or replace function public.cej_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.ref, 'purpose', c.purpose, 'project', c.project_code, 'advance', c.advance_code,
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

drop function if exists public.submit_expense_claim(text, text, jsonb);
create or replace function public.submit_expense_claim(p_purpose text, p_project_code text, p_lines jsonb, p_advance_code text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_name text; v_email text;
  v_is_super boolean; v_is_hr boolean;
  v_role text; v_mod text; v_lvl int; v_emails jsonb;
  v_project text := nullif(trim(coalesce(p_project_code, '')), '');
  v_advance text := nullif(trim(coalesce(p_advance_code, '')), '');
  v_rate numeric := public.per_diem_rate();
  v_total numeric; v_claim uuid;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_purpose, '')), '') is null then raise exception 'What is this claim for? A purpose is required'; end if;
  select name, email into v_name, v_email from public.app_users where id = v_me;

  v_is_super := exists (select 1 from public.user_permissions p where p.email = lower(v_email) and p.module = 'users' and p.level >= 3);
  v_is_hr    := exists (select 1 from public.user_permissions p where p.email = lower(v_email) and p.module = 'hr'    and p.level >= 2);

  v_ref := public.next_ref('CLM');
  insert into public.expense_claims(ref, entity_id, requester_id, requester_name, purpose, project_code, advance_code, approver_role, state,
                                    decided_by, decided_at, decision_note)
  values (v_ref, v_entity, v_me, v_name, trim(p_purpose), v_project, v_advance,
          case when v_is_super then 'auto' when v_is_hr then 'super' else 'hr' end,
          case when v_is_super then 'approved' else 'pending' end,
          case when v_is_super then v_me else null end,
          case when v_is_super then now() else null end,
          case when v_is_super then 'Auto-approved — raised by a Super Admin' else null end)
  returning id into v_claim;

  v_total := public.claim_write_lines(v_claim, p_lines, v_rate);
  update public.expense_claims set total_amount = v_total where id = v_claim;

  perform public.audit_write('expense_claim.requested', 'expense_claim', v_ref,
    jsonb_build_object('purpose', p_purpose, 'total', v_total, 'project', v_project, 'advance', v_advance));

  if v_is_super then
    perform public.claim_accrue(v_ref);
    perform public.audit_write('expense_claim.approved', 'expense_claim', v_ref, jsonb_build_object('total', v_total, 'auto', true));
    return public.cej_json(v_ref) || jsonb_build_object('autoApproved', true, 'approverRole', 'auto', 'approverEmails', '[]'::jsonb);
  end if;

  v_role := case when v_is_hr then 'super' else 'hr' end;
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

drop function if exists public.edit_expense_claim(text, text, text, jsonb);
create or replace function public.edit_expense_claim(p_ref text, p_purpose text, p_project_code text, p_lines jsonb, p_advance_code text default null)
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
    set purpose = trim(p_purpose), project_code = nullif(trim(coalesce(p_project_code, '')), ''),
        advance_code = nullif(trim(coalesce(p_advance_code, '')), ''), updated_at = now()
    where ref = p_ref;
  v_total := public.claim_write_lines(r.id, p_lines, v_rate);
  update public.expense_claims set total_amount = v_total where ref = p_ref;

  perform public.audit_write('expense_claim.edited', 'expense_claim', p_ref,
    jsonb_build_object('purpose', p_purpose, 'total', v_total, 'reopened', v_reopened));

  if not v_reopened then return public.cej_json(p_ref); end if;

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

-- ---------- grants for the changed signatures ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'advance_write_lines(uuid,jsonb,numeric,boolean)',
    'submit_travel_advance(text,text,jsonb)',
    'edit_travel_advance(text,text,text,jsonb)',
    'reconcile_travel_advance(text,jsonb)',
    'tadv_json(text)',
    'submit_expense_claim(text,text,jsonb,text)',
    'edit_expense_claim(text,text,text,jsonb,text)',
    'cej_json(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
