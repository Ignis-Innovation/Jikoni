-- ============================================================
-- 0083 — Multiple receipts per record
-- Claim lines and travel-advance lines each carried ONE receipt_path, and a petty-cash
-- request ONE invoice_path (attaching overwrote it). A single expense often has several
-- slips, so each slot becomes a list:
--   * expense_claim_lines.receipt_paths / travel_advance_lines.receipt_paths  text[]
--   * petty_cash_requests.invoice_paths                                       text[]
-- The old single columns stay (backfilled into the arrays, and kept = first item) so
-- nothing already attached is lost.
-- Receipts on claim/advance lines can now be added/removed by the claimant/holder OR by
-- HR / a Super Admin, in any state but cancelled (receipts never gate approval — 0079).
-- Idempotent (add-column-if-not-exists + create-or-replace).
-- ============================================================

alter table public.expense_claim_lines  add column if not exists receipt_paths text[] not null default '{}';
alter table public.travel_advance_lines add column if not exists receipt_paths text[] not null default '{}';
alter table public.petty_cash_requests  add column if not exists invoice_paths text[] not null default '{}';

update public.expense_claim_lines set receipt_paths = array[receipt_path]
  where nullif(trim(coalesce(receipt_path, '')), '') is not null and cardinality(receipt_paths) = 0;
update public.travel_advance_lines set receipt_paths = array[receipt_path]
  where nullif(trim(coalesce(receipt_path, '')), '') is not null and cardinality(receipt_paths) = 0;
update public.petty_cash_requests set invoice_paths = array[invoice_path]
  where nullif(trim(coalesce(invoice_path, '')), '') is not null and cardinality(invoice_paths) = 0;

-- receipt list from a client line: 'receiptPaths' (array) wins, else legacy 'receiptPath'.
-- Blank entries are dropped and duplicates collapsed (order kept).
create or replace function public.line_receipt_paths(ln jsonb) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(p order by o), '{}'::text[]) from (
    select p, min(o) o from (
      select nullif(trim(x), '') p, ord o
      from jsonb_array_elements_text(
        case when jsonb_typeof(ln->'receiptPaths') = 'array' then ln->'receiptPaths'
             when nullif(trim(coalesce(ln->>'receiptPath', '')), '') is not null then jsonb_build_array(ln->>'receiptPath')
             else '[]'::jsonb end) with ordinality t(x, ord)
    ) s where p is not null group by p
  ) d
$$;

-- ---------- claim lines writer (0078) — now stores the receipt list ----------
create or replace function public.claim_write_lines(p_claim_id uuid, p_lines jsonb, p_rate numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare ln jsonb; v_amt numeric; v_total numeric := 0; v_days int; v_cat text; v_rate numeric; v_paths text[];
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one line to the claim';
  end if;
  delete from public.expense_claim_lines where claim_id = p_claim_id;
  for ln in select value from jsonb_array_elements(p_lines) loop
    if coalesce((ln->>'isPerDiem')::boolean, false) then
      v_days := coalesce((ln->>'perDiemDays')::int, 0);
      if v_days <= 0 then raise exception 'Per-diem days must be greater than zero'; end if;
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
      v_paths := public.line_receipt_paths(ln);
      insert into public.expense_claim_lines(claim_id, category, detail, amount, receipt_path, receipt_paths, is_per_diem)
      values (p_claim_id, v_cat, nullif(trim(coalesce(ln->>'detail','')),''), v_amt, v_paths[1], v_paths, false);
    end if;
    v_total := v_total + v_amt;
  end loop;
  return v_total;
end $$;

-- ---------- advance lines writer (0081) — now stores the receipt list ----------
create or replace function public.advance_write_lines(p_advance_id uuid, p_lines jsonb, p_rate numeric, p_is_estimate boolean)
returns numeric language plpgsql security definer set search_path = public as $$
declare ln jsonb; v_amt numeric; v_total numeric := 0; v_days int; v_cat text; v_rate numeric; v_paths text[];
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
      v_paths := public.line_receipt_paths(ln);
      insert into public.travel_advance_lines(advance_id, category, detail, amount, receipt_path, receipt_paths, is_per_diem, is_estimate)
      values (p_advance_id, v_cat, nullif(trim(coalesce(ln->>'detail','')),''), v_amt, v_paths[1], v_paths, false, p_is_estimate);
    end if;
    v_total := v_total + v_amt;
  end loop;
  return v_total;
end $$;

-- ---------- read shapes: add receiptPaths / invoicePaths ----------
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
        'receiptPath', l.receipt_path, 'receiptPaths', to_jsonb(l.receipt_paths), 'isPerDiem', l.is_per_diem,
        'perDiemDays', l.per_diem_days, 'perDiemRate', l.per_diem_rate_used
      ) order by l.created_at)
      from public.expense_claim_lines l where l.claim_id = c.id), '[]'::jsonb))
  from public.expense_claims c
  left join public.app_users rq on rq.id = c.requester_id
  left join public.app_users dc on dc.id = c.decided_by
  left join public.app_users pb on pb.id = c.paid_by
  where c.ref = p_ref
$$;

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
        'receiptPath', l.receipt_path, 'receiptPaths', to_jsonb(l.receipt_paths), 'isPerDiem', l.is_per_diem,
        'perDiemDays', l.per_diem_days, 'perDiemRate', l.per_diem_rate_used
      ) order by l.created_at)
      from public.travel_advance_lines l where l.advance_id = a.id and l.is_estimate), '[]'::jsonb),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'category', l.category, 'detail', l.detail, 'amount', l.amount,
        'receiptPath', l.receipt_path, 'receiptPaths', to_jsonb(l.receipt_paths), 'isPerDiem', l.is_per_diem,
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

create or replace function public.pcr_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.ref, 'item', r.item, 'amount', r.amount,
    'needBy', to_char(r.need_by, 'YYYY-MM-DD'), 'reason', r.reason, 'state', r.state,
    'requester', rq.name, 'requesterEmail', rq.email, 'approverRole', r.approver_role,
    'superApprovedBy', su.name, 'superApprovedAt', r.super_approved_at,
    'hrApprovedBy', hr.name, 'hrApprovedAt', r.hr_approved_at,
    'decidedBy', dc.name, 'decidedAt', r.decided_at, 'note', r.decision_note,
    'invoicePath', r.invoice_path, 'invoicePaths', to_jsonb(r.invoice_paths),
    'createdAt', r.created_at)
  from public.petty_cash_requests r
  left join public.app_users rq on rq.id = r.requester_id
  left join public.app_users su on su.id = r.super_approved_by
  left join public.app_users hr on hr.id = r.hr_approved_by
  left join public.app_users dc on dc.id = r.decided_by
  where r.ref = p_ref
$$;

-- clean a client-sent path array: trim, drop blanks, keep order
create or replace function public.clean_paths(p text[]) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(x order by o), '{}'::text[])
  from (select nullif(trim(v), '') x, o from unnest(coalesce(p, '{}'::text[])) with ordinality u(v, o)) s
  where x is not null
$$;

-- ---------- claim line receipts: add many / remove one ----------
create or replace function public.add_claim_line_receipts(p_line_id uuid, p_paths text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_paths text[] := public.clean_paths(p_paths);
  r record; v_per_diem boolean;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if cardinality(v_paths) = 0 then raise exception 'No file was provided'; end if;
  select c.*, l.is_per_diem as line_per_diem into r from public.expense_claims c
    join public.expense_claim_lines l on l.claim_id = c.id where l.id = p_line_id;
  if not found then raise exception 'Line not found'; end if;
  if not (r.requester_id = v_me or public.can_petty_super() or public.can_petty_hr()) then
    raise exception 'Only the claimant or HR can attach receipts to this claim';
  end if;
  if r.state = 'cancelled' then raise exception 'This claim was withdrawn'; end if;
  if r.line_per_diem then raise exception 'Per-diem lines do not take receipts'; end if;
  update public.expense_claim_lines l
    set receipt_paths = l.receipt_paths || array(select x from unnest(v_paths) x where not x = any(l.receipt_paths)),
        receipt_path  = coalesce(l.receipt_path, v_paths[1])
    where l.id = p_line_id;
  perform public.audit_write('expense_claim.receipts_added', 'expense_claim', r.ref,
    jsonb_build_object('line', p_line_id, 'paths', to_jsonb(v_paths)));
  return public.cej_json(r.ref);
end $$;

create or replace function public.remove_claim_line_receipt(p_line_id uuid, p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); r record;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  select c.* into r from public.expense_claims c
    join public.expense_claim_lines l on l.claim_id = c.id where l.id = p_line_id;
  if not found then raise exception 'Line not found'; end if;
  if not (r.requester_id = v_me or public.can_petty_super() or public.can_petty_hr()) then
    raise exception 'Only the claimant or HR can remove receipts from this claim';
  end if;
  if r.state = 'cancelled' then raise exception 'This claim was withdrawn'; end if;
  update public.expense_claim_lines l
    set receipt_paths = array_remove(l.receipt_paths, p_path),
        receipt_path  = (array_remove(l.receipt_paths, p_path))[1]
    where l.id = p_line_id;
  perform public.audit_write('expense_claim.receipt_removed', 'expense_claim', r.ref,
    jsonb_build_object('line', p_line_id, 'path', p_path));
  return public.cej_json(r.ref);
end $$;

-- ---------- advance line receipts: add many / remove one ----------
create or replace function public.add_advance_line_receipts(p_line_id uuid, p_paths text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_paths text[] := public.clean_paths(p_paths);
  r record;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if cardinality(v_paths) = 0 then raise exception 'No file was provided'; end if;
  select a.*, l.is_per_diem as line_per_diem into r from public.travel_advances a
    join public.travel_advance_lines l on l.advance_id = a.id where l.id = p_line_id;
  if not found then raise exception 'Line not found'; end if;
  if not (r.holder_id = v_me or public.can_petty_super() or public.can_petty_hr()) then
    raise exception 'Only the advance holder or HR can attach receipts to this advance';
  end if;
  if r.state = 'cancelled' then raise exception 'This advance was withdrawn'; end if;
  if r.line_per_diem then raise exception 'Per-diem lines do not take receipts'; end if;
  update public.travel_advance_lines l
    set receipt_paths = l.receipt_paths || array(select x from unnest(v_paths) x where not x = any(l.receipt_paths)),
        receipt_path  = coalesce(l.receipt_path, v_paths[1])
    where l.id = p_line_id;
  perform public.audit_write('travel_advance.receipts_added', 'travel_advance', r.ref,
    jsonb_build_object('line', p_line_id, 'paths', to_jsonb(v_paths)));
  return public.tadv_json(r.ref);
end $$;

create or replace function public.remove_advance_line_receipt(p_line_id uuid, p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); r record;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  select a.* into r from public.travel_advances a
    join public.travel_advance_lines l on l.advance_id = a.id where l.id = p_line_id;
  if not found then raise exception 'Line not found'; end if;
  if not (r.holder_id = v_me or public.can_petty_super() or public.can_petty_hr()) then
    raise exception 'Only the advance holder or HR can remove receipts from this advance';
  end if;
  if r.state = 'cancelled' then raise exception 'This advance was withdrawn'; end if;
  update public.travel_advance_lines l
    set receipt_paths = array_remove(l.receipt_paths, p_path),
        receipt_path  = (array_remove(l.receipt_paths, p_path))[1]
    where l.id = p_line_id;
  perform public.audit_write('travel_advance.receipt_removed', 'travel_advance', r.ref,
    jsonb_build_object('line', p_line_id, 'path', p_path));
  return public.tadv_json(r.ref);
end $$;

-- ---------- petty cash: attach APPENDS; remove drops one file ----------
create or replace function public.attach_petty_cash_invoice(p_ref text, p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_path text := nullif(trim(coalesce(p_path, '')), '');
  r record;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if v_path is null then raise exception 'No file was provided'; end if;
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if not (r.requester_id = v_me or public.can_petty_super() or public.can_petty_hr()) then
    raise exception 'Only the requester or a petty-cash approver can attach an invoice';
  end if;
  if r.state <> 'approved' then
    raise exception 'You can only attach an invoice to an approved request';
  end if;
  update public.petty_cash_requests
    set invoice_paths = case when v_path = any(invoice_paths) then invoice_paths else invoice_paths || v_path end,
        invoice_path  = coalesce(invoice_path, v_path),
        updated_at    = now()
    where ref = p_ref;
  perform public.audit_write('petty_cash.invoice_attached', 'petty_cash_request', p_ref,
    jsonb_build_object('path', v_path));
  return public.pcr_json(p_ref);
end $$;

-- legacy one-arg remove (0067) now clears ALL attachments, keeping both columns in sync
create or replace function public.remove_petty_cash_invoice(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  r record;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if not (r.requester_id = v_me or public.can_petty_super() or public.can_petty_hr()) then
    raise exception 'Only the requester or a petty-cash approver can remove an invoice';
  end if;
  update public.petty_cash_requests set invoice_path = null, invoice_paths = '{}', updated_at = now() where ref = p_ref;
  perform public.audit_write('petty_cash.invoice_removed', 'petty_cash_request', p_ref, '{}'::jsonb);
  return public.pcr_json(p_ref);
end $$;

create or replace function public.remove_petty_cash_invoice(p_ref text, p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  r record;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if not (r.requester_id = v_me or public.can_petty_super() or public.can_petty_hr()) then
    raise exception 'Only the requester or a petty-cash approver can remove an invoice';
  end if;
  update public.petty_cash_requests
    set invoice_paths = array_remove(invoice_paths, p_path),
        invoice_path  = (array_remove(invoice_paths, p_path))[1],
        updated_at    = now()
    where ref = p_ref;
  perform public.audit_write('petty_cash.invoice_removed', 'petty_cash_request', p_ref,
    jsonb_build_object('path', p_path));
  return public.pcr_json(p_ref);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'line_receipt_paths(jsonb)',
    'clean_paths(text[])',
    'claim_write_lines(uuid,jsonb,numeric)',
    'advance_write_lines(uuid,jsonb,numeric,boolean)',
    'cej_json(text)',
    'tadv_json(text)',
    'pcr_json(text)',
    'add_claim_line_receipts(uuid,text[])',
    'remove_claim_line_receipt(uuid,text)',
    'add_advance_line_receipts(uuid,text[])',
    'remove_advance_line_receipt(uuid,text)',
    'attach_petty_cash_invoice(text,text)',
    'remove_petty_cash_invoice(text)',
    'remove_petty_cash_invoice(text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
