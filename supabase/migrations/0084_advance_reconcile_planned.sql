-- 0084: reconcile travel advances AGAINST the planned lines.
-- Staff already list expense lines when requesting an advance; reconciliation now
-- starts from those lines (spent amount + receipts per planned item) instead of
-- re-typing them. Each actual line may point at the planned line it accounts for.
-- A planned item that was not spent at all is recorded as a linked line of 0.
-- Idempotent.

alter table public.travel_advance_lines
  add column if not exists planned_line_id uuid references public.travel_advance_lines(id) on delete set null;

create index if not exists travel_advance_lines_planned_idx on public.travel_advance_lines(planned_line_id);

-- ---------- lines writer: accepts plannedLineId on actual lines ----------
create or replace function public.advance_write_lines(p_advance_id uuid, p_lines jsonb, p_rate numeric, p_is_estimate boolean)
returns numeric language plpgsql security definer set search_path = public as $$
declare ln jsonb; v_amt numeric; v_total numeric := 0; v_days int; v_cat text; v_rate numeric; v_paths text[];
        v_plan uuid; v_plan_cat text; v_plan_detail text;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception '%', case when p_is_estimate then 'Add at least one line to build up the advance amount' else 'Add at least one line to account for the advance' end;
  end if;
  delete from public.travel_advance_lines where advance_id = p_advance_id and is_estimate = p_is_estimate;
  for ln in select value from jsonb_array_elements(p_lines) loop
    v_plan := null; v_plan_cat := null; v_plan_detail := null;
    if not p_is_estimate and nullif(ln->>'plannedLineId','') is not null then
      select id, category, detail into v_plan, v_plan_cat, v_plan_detail
        from public.travel_advance_lines
       where id = (ln->>'plannedLineId')::uuid and advance_id = p_advance_id and is_estimate;
      if v_plan is null then raise exception 'That planned line does not belong to this advance'; end if;
    end if;

    if coalesce((ln->>'isPerDiem')::boolean, false) then
      v_days := coalesce((ln->>'perDiemDays')::int, 0);
      if v_days < 0 or (v_days = 0 and v_plan is null) then raise exception 'Per-diem days must be greater than zero'; end if;
      v_rate := coalesce(nullif(ln->>'perDiemRate','')::numeric, p_rate, 0);
      if v_rate <= 0 then raise exception 'Enter a per-diem rate per day greater than zero'; end if;
      v_amt := v_days * v_rate;
      insert into public.travel_advance_lines(advance_id, category, detail, amount, is_per_diem, per_diem_days, per_diem_rate_used, is_estimate, planned_line_id)
      values (p_advance_id, 'per_diem', coalesce(nullif(trim(coalesce(ln->>'detail','')),''), v_plan_detail), v_amt, true, v_days, v_rate, p_is_estimate, v_plan);
    else
      v_amt := coalesce((ln->>'amount')::numeric, 0);
      if v_amt < 0 or (v_amt = 0 and v_plan is null) then raise exception 'Each line needs an amount greater than zero'; end if;
      v_cat := coalesce(nullif(trim(coalesce(ln->>'category','')),''), v_plan_cat);
      if v_cat is null or v_cat not in ('transport','accommodation','meals','airtime','supplies','other') then
        raise exception 'Choose a category for each line';
      end if;
      v_paths := public.line_receipt_paths(ln);
      insert into public.travel_advance_lines(advance_id, category, detail, amount, receipt_path, receipt_paths, is_per_diem, is_estimate, planned_line_id)
      values (p_advance_id, v_cat, coalesce(nullif(trim(coalesce(ln->>'detail','')),''), v_plan_detail), v_amt, v_paths[1], v_paths, false, p_is_estimate, v_plan);
    end if;
    v_total := v_total + v_amt;
  end loop;
  return v_total;
end $$;

-- ---------- read shape: expose plannedLineId ----------
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
        'perDiemDays', l.per_diem_days, 'perDiemRate', l.per_diem_rate_used, 'plannedLineId', l.planned_line_id
      ) order by l.created_at)
      from public.travel_advance_lines l where l.advance_id = a.id and not l.is_estimate), '[]'::jsonb))
  from public.travel_advances a
  left join public.app_users h  on h.id  = a.holder_id
  left join public.app_users dc on dc.id = a.decided_by
  left join public.app_users ib on ib.id = a.issued_by
  left join public.app_users sb on sb.id = a.settled_by
  where a.ref = p_ref
$$;
