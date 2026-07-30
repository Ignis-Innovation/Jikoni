-- ============================================================
-- 0035 — Purge illustrative/demo module data for a clean slate.
-- The prototype seeded every module with demo records (0003_seed_kenya
-- and the phase migrations). Now that the tool is going live we clear
-- those out so real data can be entered module by module.
--
-- KEPT (not demo, or would break the app / auth if removed):
--   • User Management — app_users, user_permissions, role_templates
--   • Config / reference — entities, chart_of_accounts, approval_matrix,
--     budget_lines (definitions; usage reset to 0), crm_dropdown_options,
--     app_config, statutory_rates, leave_policies, stock_locations,
--     ref_counters, record_transitions, sod_conflicts
--   • audit_log (append-only — immutable by trigger)
--   • The surviving real users' HR footing — staff_files (employment
--     record) and leave_balances (entitlements) so HR & leave still work
--
-- Deletes run children-before-parents to satisfy foreign keys.
-- Idempotent: plain DELETEs; re-running against empty tables is a no-op.
-- ============================================================

begin;

-- ---------- children of engagements ----------
delete from public.engagement_partners;
delete from public.engagement_notes;
delete from public.engagement_updates;
delete from public.engagement_documents;

-- ---------- children of projects ----------
delete from public.eng_project_links;      -- also references engagements
delete from public.project_drawdowns;
delete from public.project_milestones;
delete from public.field_activities;
delete from public.field_assignments;      -- also references enumerators
delete from public.dispatches;

-- ---------- recruitment / field roster ----------
delete from public.candidates;             -- child of recruitment_reqs
delete from public.recruitment_reqs;
delete from public.enumerators;

-- ---------- inventory & assets (stock ledger is append-only; lift the guard) ----------
alter table public.stock_movements disable trigger ledger_no_edit;
delete from public.asset_depreciations;    -- child of assets
delete from public.stock_movements;        -- child of stock_items
delete from public.stock_levels;           -- child of stock_items
delete from public.stock_items;
delete from public.assets;
alter table public.stock_movements enable trigger ledger_no_edit;

-- ---------- procurement / finance payments (children of vendors / invoices) ----------
delete from public.sanctions_checks;       -- child of vendors
delete from public.vendor_screenings;      -- child of vendors
delete from public.purchase_orders;        -- child of vendors
delete from public.contracts;              -- child of vendors
delete from public.mpesa_payments;         -- child of payments
delete from public.payments;               -- child of invoices_ap
delete from public.invoices_ap;            -- child of vendors
delete from public.etims_submissions;      -- child of sales_invoices
delete from public.sales_invoices;
delete from public.requisitions;
delete from public.goods_received_notes;
delete from public.vendors;

-- ---------- finance ledger & banking ----------
delete from public.journal_lines;          -- child of journal_entries
delete from public.journal_entries;
delete from public.bank_accounts;
delete from public.petty_cash_floats;

-- ---------- payroll ----------
delete from public.payroll_items;          -- child of payroll_runs
delete from public.payroll_runs;

-- ---------- now the parents ----------
delete from public.engagements;
delete from public.projects;

-- ---------- Partnerships CRM registries & fundraise ----------
delete from public.partners;
delete from public.opportunities;
delete from public.diligence_requests;     -- child of raise_pipeline
delete from public.term_sheets;            -- child of raise_pipeline
delete from public.raise_pipeline;
delete from public.dataroom_access_log;    -- child of dataroom_grants
delete from public.dataroom_grants;

-- ---------- Compliance & Governance ----------
delete from public.policies;
delete from public.company_documents;
delete from public.compliance_obligations;
delete from public.risks;

-- ---------- Home — My Week tasks ----------
delete from public.tasks;

-- ---------- HR — demo personnel rows (app_users, staff_files, leave_balances kept) ----------
delete from public.appraisals;
delete from public.certifications;
delete from public.staff_feedback;
delete from public.staff_exits;
delete from public.leave_applications;

-- ---------- reset budget-line usage; clean the kept users' leave ledger ----------
update public.budget_lines set committed = 0, actual = 0;
update public.leave_balances set used = 0, reserved = 0;

commit;
