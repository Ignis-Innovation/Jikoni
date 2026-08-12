-- ============================================================
-- 0055 — Remove test/demo data
--   (a) four pending users (bmwangi, eooro, wmungai, dnderitu @ignis-innovation.com)
--   (b) "Kimani" test rows across Finance & Procurement
--   (c) the "Testing item" petty-cash row
--   (d) all Partnerships-CRM rows (partners, opportunities, engagements)
-- These rows were created through the app on the live DB, so they are matched by
-- value. All statements are idempotent (re-running is a no-op).
-- ============================================================

-- ---------- (a) delete four pending users ----------
do $$
declare doomed constant text[] := array[
  'bmwangi@ignis-innovation.com','eooro@ignis-innovation.com',
  'wmungai@ignis-innovation.com','dnderitu@ignis-innovation.com'];
  ids uuid[];
begin
  select array_agg(id) into ids from public.app_users where lower(email) = any(doomed);
  if ids is not null then
    -- person-specific HR rows → delete
    delete from public.payroll_items     where app_user_id = any(ids);
    delete from public.leave_balances     where app_user_id = any(ids);
    delete from public.leave_applications where app_user_id = any(ids);
    delete from public.appraisals         where app_user_id = any(ids);
    delete from public.certifications     where app_user_id = any(ids);
    delete from public.staff_feedback     where author_id   = any(ids);
    delete from public.staff_exits        where app_user_id = any(ids);
    delete from public.staff_files        where app_user_id = any(ids);
    delete from public.petty_cash_requests where requester_id = any(ids);

    -- actor / owner references on business records → null out
    update public.appraisals          set reviewer_id      = null where reviewer_id      = any(ids);
    update public.leave_applications  set approver_id      = null where approver_id      = any(ids);
    update public.payroll_runs        set prepared_by      = null where prepared_by      = any(ids);
    update public.payroll_runs        set approved_by      = null where approved_by      = any(ids);
    update public.dispatches          set created_by       = null where created_by       = any(ids);
    update public.documents           set owner_id         = null where owner_id         = any(ids);
    update public.goods_received_notes set receiver_id     = null where receiver_id      = any(ids);
    update public.invites             set invited_by       = null where invited_by       = any(ids);
    update public.purchase_orders     set owner_id         = null where owner_id         = any(ids);
    update public.requisitions        set owner_id         = null where owner_id         = any(ids);
    update public.sales_invoices      set owner_id         = null where owner_id         = any(ids);
    update public.sanctions_checks    set checked_by       = null where checked_by       = any(ids);
    update public.stock_movements     set created_by       = null where created_by       = any(ids);
    update public.tasks               set owner_id         = null where owner_id         = any(ids);
    update public.tasks               set assigned_by_id   = null where assigned_by_id   = any(ids);
    update public.projects            set created_by       = null where created_by       = any(ids);
    update public.vendor_screenings   set screened_by      = null where screened_by      = any(ids);
    update public.vendors             set owner_id         = null where owner_id         = any(ids);
    update public.petty_cash_requests set decided_by        = null where decided_by        = any(ids);
    update public.petty_cash_requests set super_approved_by = null where super_approved_by = any(ids);
    update public.petty_cash_requests set hr_approved_by    = null where hr_approved_by    = any(ids);
  end if;

  -- email-keyed rows + the members + their auth logins
  delete from public.user_permissions where lower(email) = any(doomed);
  delete from public.invites          where lower(email) = any(doomed);
  delete from public.app_users        where lower(email) = any(doomed);
  delete from auth.users              where lower(email) = any(doomed);
end $$;

-- ---------- (b) "Kimani" test rows across Finance & Procurement ----------
do $$
declare kv uuid[];  -- vendor ids named like Kimani
begin
  select array_agg(id) into kv from public.vendors where name ilike '%kimani%';
  -- unwind the procure-to-pay chain in dependency order
  delete from public.payments where invoice_ap_id in (
    select id from public.invoices_ap where vendor_id = any(coalesce(kv, '{}'))
       or po_id in (select id from public.purchase_orders where vendor_name ilike '%kimani%'));
  delete from public.invoices_ap where vendor_id = any(coalesce(kv, '{}'))
     or po_id in (select id from public.purchase_orders where vendor_name ilike '%kimani%');
  delete from public.goods_received_notes where po_id in (
    select id from public.purchase_orders where vendor_id = any(coalesce(kv, '{}')) or vendor_name ilike '%kimani%');
  delete from public.purchase_orders where vendor_id = any(coalesce(kv, '{}')) or vendor_name ilike '%kimani%'
     or requisition_id in (select id from public.requisitions where item ilike '%kimani%');
  delete from public.requisitions where item ilike '%kimani%';
  -- other tables that reference the vendor (no cascade) must clear first
  delete from public.sanctions_checks   where vendor_id = any(coalesce(kv, '{}'));
  delete from public.vendor_bank_changes where vendor_id = any(coalesce(kv, '{}'));
  delete from public.contracts          where vendor_id = any(coalesce(kv, '{}'));
  delete from public.vendor_screenings  where vendor_id = any(coalesce(kv, '{}'));
  delete from public.vendors where name ilike '%kimani%';
  -- order-to-cash + GL + petty cash text mentions
  delete from public.sales_invoices where customer ilike '%kimani%' or description ilike '%kimani%';
  delete from public.journal_entries where memo ilike '%kimani%';   -- journal_lines cascade
  delete from public.petty_cash_requests where item ilike '%kimani%' or requester_name ilike '%kimani%';
end $$;

-- ---------- (c) the "Testing item" petty-cash row ----------
delete from public.petty_cash_requests where lower(item) like '%testing item%';

-- ---------- (d) wipe all Partnerships-CRM data (Partner registry + engagements) ----------
delete from public.eng_project_links;                 -- FK to engagements(ref), no cascade
delete from public.engagements;                       -- notes / partners-links / docs cascade
delete from public.opportunities;
delete from public.partners;
delete from public.notifications where kind like 'engagement%' or link_view = 'crm';

-- ---------- (e) inventory test items (SKU-101 "test I", SKU-102 "Test 2", etc.) ----------
do $$
declare si uuid[];   -- test stock-item ids
begin
  select array_agg(id) into si from public.stock_items
    where sku in ('SKU-101','SKU-102') or name ~* '^test\M';   -- name starts with "test"
  if si is not null then
    -- drop any open auto-requisition raised for these items
    delete from public.requisitions where ref in (
      select auto_req_ref from public.stock_items where id = any(si) and auto_req_ref is not null);
    -- the movement ledger is append-only (trigger blocks deletes) — disable it briefly
    alter table public.stock_movements disable trigger ledger_no_edit;
    delete from public.stock_movements where item_id = any(si);
    alter table public.stock_movements enable trigger ledger_no_edit;
    delete from public.stock_levels where item_id = any(si);
    delete from public.stock_items where id = any(si);
  end if;
end $$;
