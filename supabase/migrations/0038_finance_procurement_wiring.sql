-- ============================================================
-- Jikoni Tool — Finance & Procurement wiring round
-- The procure-to-pay + payables/receivables spine already exists as RPCs
-- (submit_requisition, budget_check, approve_requisition, raise_po, submit_grn,
-- capture_ap_invoice, three_way_match, pay_invoice, screen_vendor,
-- submit_sales_invoice, post_journal). This migration adds the few missing pieces
-- so the modules run end to end on real data:
--   * create_vendor        — onboard a supplier (screening comes after, via screen_vendor)
--   * record_ar_receipt     — record a collection against a sales invoice + post the journal
--   * account_balances()    — trial-balance read model for the General Ledger tab
--   * chart_of_accounts read policy (the only spine table without one)
-- Idempotent: safe to re-run.
-- ============================================================

-- chart_of_accounts is the only spine table missing a read policy (needed for the GL tab)
alter table public.chart_of_accounts enable row level security;
drop policy if exists "read for authenticated" on public.chart_of_accounts;
create policy "read for authenticated" on public.chart_of_accounts for select to authenticated using (true);

-- ---------- onboard a vendor (screening + tax gate applied later) ----------
create or replace function public.create_vendor(
  p_name text, p_category text default null, p_country text default 'Kenya',
  p_kra_pin text default null, p_bank text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_owner  uuid := (select id from public.app_users where auth_id = auth.uid());
  v_pin text := nullif(trim(coalesce(p_kra_pin, '')), '');
  v_id uuid;
begin
  perform public.assert_access('procurement', 2);
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'A vendor needs a name'; end if;
  if exists (select 1 from public.vendors where name = trim(p_name)) then
    raise exception 'A vendor named "%" already exists', trim(p_name);
  end if;
  insert into public.vendors(entity_id, owner_id, name, category, country, tax_status, bank, since,
                             screen_status, state)
  values (v_entity, v_owner, trim(p_name), nullif(trim(coalesce(p_category, '')), ''),
          coalesce(nullif(trim(coalesce(p_country, '')), ''), 'Kenya'),
          case when v_pin is not null then 'PIN ' || v_pin else 'Pending PIN' end,
          nullif(trim(coalesce(p_bank, '')), ''), to_char(now(), 'Mon YYYY'),
          'pending', 'draft')
  returning id into v_id;
  perform public.audit_write('vendor.created', 'vendor', trim(p_name),
    jsonb_build_object('category', p_category, 'country', p_country, 'kra', v_pin));
  return jsonb_build_object('id', v_id, 'name', trim(p_name), 'category', p_category,
    'country', coalesce(p_country, 'Kenya'), 'screenStatus', 'pending', 'state', 'draft');
end $$;

-- ---------- record a collection against a sales invoice ----------
create or replace function public.record_ar_receipt(p_inv_ref text, p_amount numeric, p_method text default 'bank')
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv record; je text;
begin
  perform public.assert_access('finance', 2);
  if coalesce(p_amount, 0) <= 0 then raise exception 'A receipt amount is required'; end if;
  select * into inv from public.sales_invoices where ref = p_inv_ref;
  if not found then raise exception 'Sales invoice % not found', p_inv_ref; end if;
  if inv.state = 'paid' then raise exception '% is already settled', p_inv_ref; end if;
  -- cash in, receivable down
  je := public.post_journal('Receipt for ' || p_inv_ref || ' — ' || inv.customer, 'receipt', p_inv_ref,
    jsonb_build_array(
      jsonb_build_object('account', case when p_method = 'mpesa' then '1000' else '1000' end, 'debit', p_amount),
      jsonb_build_object('account', '1100', 'credit', p_amount)));
  update public.sales_invoices set state = 'paid', due_pill_cls = 'done', due_pill_txt = 'Paid', updated_at = now()
   where id = inv.id;
  perform public.audit_write('receipt.recorded', 'sales_invoice', p_inv_ref,
    jsonb_build_object('amount', p_amount, 'method', p_method, 'journal', je));
  return jsonb_build_object('invoice', p_inv_ref, 'amount', p_amount, 'journal', je);
end $$;

-- ---------- trial-balance read model for the General Ledger tab ----------
-- Sums posted journal lines per account and joins the chart of accounts so the GL
-- shows a balance per account with its type. Balance is signed by account kind.
create or replace function public.account_balances() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'name', name, 'kind', kind,
      'debit', debit, 'credit', credit,
      'balance', case when kind in ('asset','expense') then debit - credit else credit - debit end)
      order by code), '[]'::jsonb)
  from (
    select coa.code, coa.name, coa.kind,
           coalesce(sum(jl.debit), 0)  as debit,
           coalesce(sum(jl.credit), 0) as credit
    from public.chart_of_accounts coa
    left join public.journal_lines jl on jl.account_code = coa.code
    left join public.journal_entries je on je.id = jl.journal_id and je.state = 'posted'
    where coa.active
    group by coa.code, coa.name, coa.kind
    having coalesce(sum(jl.debit), 0) <> 0 or coalesce(sum(jl.credit), 0) <> 0
  ) q
$$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_vendor(text,text,text,text,text)',
    'record_ar_receipt(text,numeric,text)',
    'account_balances()']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
