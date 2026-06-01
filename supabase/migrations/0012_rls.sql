-- ============================================================================
-- 0012_rls.sql — Row-Level Security (PRD gate B7: enforce permissions server-side)
-- Pattern: SELECT gated by '<area>.view' (super_admin passes everything via
-- has_permission); writes gated by '<area>.<action>'. Reference data + the user
-- directory are readable by any authenticated user. audit_log and events are
-- read-only to the app — only SECURITY DEFINER triggers write them.
-- ============================================================================

-- Enable RLS on every spine table.
do $$
declare t text;
declare tbls text[] := array[
  'users','roles','permissions','role_permissions','user_roles',
  'institutions','departments','projects','locations','cost_centers',
  'accounts','fiscal_periods','opening_balances',
  'parties','party_types','party_contacts','party_bank_details',
  'documents','document_versions','audit_log','events',
  'approval_chains','approval_steps','approval_requests','approval_actions',
  'notifications','notification_prefs',
  'currencies','tax_codes','units_of_measure','categories','id_sequences'
];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- Helper to keep policies terse.
-- (We write explicit policies below rather than templating, for clarity.)

-- ---- Reference data + user directory: readable by all authenticated --------
create policy ref_read_currencies   on public.currencies        for select to authenticated using (true);
create policy ref_read_taxcodes     on public.tax_codes         for select to authenticated using (true);
create policy ref_read_uom          on public.units_of_measure  for select to authenticated using (true);
create policy ref_read_categories   on public.categories        for select to authenticated using (deleted_at is null);
create policy users_read_directory  on public.users             for select to authenticated using (true);

-- Reference data writes: refdata.manage
create policy ref_write_currencies  on public.currencies       for all to authenticated using (public.has_permission('refdata.manage')) with check (public.has_permission('refdata.manage'));
create policy ref_write_taxcodes    on public.tax_codes        for all to authenticated using (public.has_permission('refdata.manage')) with check (public.has_permission('refdata.manage'));
create policy ref_write_uom         on public.units_of_measure for all to authenticated using (public.has_permission('refdata.manage')) with check (public.has_permission('refdata.manage'));
create policy ref_write_categories  on public.categories       for all to authenticated using (public.has_permission('refdata.manage')) with check (public.has_permission('refdata.manage'));

-- ---- Identity --------------------------------------------------------------
create policy users_write   on public.users for update to authenticated
  using (public.has_permission('identity.users.edit') or id = auth.uid())
  with check (public.has_permission('identity.users.edit') or id = auth.uid());
create policy users_insert  on public.users for insert to authenticated
  with check (public.has_permission('identity.users.create'));

create policy roles_read    on public.roles for select to authenticated using (public.has_permission('identity.roles.view'));
create policy roles_write   on public.roles for all to authenticated
  using (public.has_permission('identity.roles.edit')) with check (public.has_permission('identity.roles.edit'));

create policy perms_read    on public.permissions for select to authenticated using (public.has_permission('identity.roles.view'));
create policy rp_read       on public.role_permissions for select to authenticated using (public.has_permission('identity.roles.view'));
create policy rp_write      on public.role_permissions for all to authenticated
  using (public.has_permission('identity.roles.edit')) with check (public.has_permission('identity.roles.edit'));

create policy ur_read       on public.user_roles for select to authenticated
  using (public.has_permission('identity.users.view') or user_id = auth.uid());
create policy ur_write      on public.user_roles for all to authenticated
  using (public.has_permission('identity.users.edit')) with check (public.has_permission('identity.users.edit'));

-- ---- Generic CRUD areas: SELECT by .view, writes by .create/.edit ----------
-- Org model
create policy org_inst_read  on public.institutions for select to authenticated using (public.has_permission('org.view'));
create policy org_inst_ins   on public.institutions for insert to authenticated with check (public.has_permission('org.create'));
create policy org_inst_upd   on public.institutions for update to authenticated using (public.has_permission('org.edit')) with check (public.has_permission('org.edit'));
create policy org_dept_read  on public.departments for select to authenticated using (public.has_permission('org.view'));
create policy org_dept_ins   on public.departments for insert to authenticated with check (public.has_permission('org.create'));
create policy org_dept_upd   on public.departments for update to authenticated using (public.has_permission('org.edit')) with check (public.has_permission('org.edit'));
create policy org_proj_read  on public.projects for select to authenticated using (public.has_permission('org.view'));
create policy org_proj_ins   on public.projects for insert to authenticated with check (public.has_permission('org.create'));
create policy org_proj_upd   on public.projects for update to authenticated using (public.has_permission('org.edit')) with check (public.has_permission('org.edit'));
create policy org_loc_read   on public.locations for select to authenticated using (public.has_permission('org.view'));
create policy org_loc_ins    on public.locations for insert to authenticated with check (public.has_permission('org.create'));
create policy org_loc_upd    on public.locations for update to authenticated using (public.has_permission('org.edit')) with check (public.has_permission('org.edit'));
create policy org_cc_read    on public.cost_centers for select to authenticated using (public.has_permission('org.view'));
create policy org_cc_ins     on public.cost_centers for insert to authenticated with check (public.has_permission('org.create'));
create policy org_cc_upd     on public.cost_centers for update to authenticated using (public.has_permission('org.edit')) with check (public.has_permission('org.edit'));

-- Chart of accounts
create policy coa_acc_read   on public.accounts for select to authenticated using (public.has_permission('coa.view'));
create policy coa_acc_ins    on public.accounts for insert to authenticated with check (public.has_permission('coa.edit'));
create policy coa_acc_upd    on public.accounts for update to authenticated using (public.has_permission('coa.edit')) with check (public.has_permission('coa.edit'));
create policy coa_per_read   on public.fiscal_periods for select to authenticated using (public.has_permission('coa.view'));
create policy coa_per_write  on public.fiscal_periods for all to authenticated using (public.has_permission('coa.edit')) with check (public.has_permission('coa.edit'));
create policy coa_ob_read    on public.opening_balances for select to authenticated using (public.has_permission('coa.view'));
create policy coa_ob_write   on public.opening_balances for all to authenticated using (public.has_permission('coa.edit')) with check (public.has_permission('coa.edit'));

-- Parties
create policy party_read     on public.parties for select to authenticated using (public.has_permission('parties.view'));
create policy party_ins      on public.parties for insert to authenticated with check (public.has_permission('parties.create'));
create policy party_upd      on public.parties for update to authenticated using (public.has_permission('parties.edit')) with check (public.has_permission('parties.edit'));
create policy pt_read        on public.party_types for select to authenticated using (public.has_permission('parties.view'));
create policy pt_write       on public.party_types for all to authenticated using (public.has_permission('parties.edit')) with check (public.has_permission('parties.edit'));
create policy pc_read        on public.party_contacts for select to authenticated using (public.has_permission('parties.view'));
create policy pc_write       on public.party_contacts for all to authenticated using (public.has_permission('parties.edit')) with check (public.has_permission('parties.edit'));
create policy pb_read        on public.party_bank_details for select to authenticated using (public.has_permission('parties.view'));
create policy pb_write       on public.party_bank_details for all to authenticated using (public.has_permission('parties.edit')) with check (public.has_permission('parties.edit'));

-- Documents (any authenticated with documents.view can read; create/delete gated)
create policy doc_read       on public.documents for select to authenticated using (public.has_permission('documents.view'));
create policy doc_ins        on public.documents for insert to authenticated with check (public.has_permission('documents.create'));
create policy doc_upd        on public.documents for update to authenticated using (public.has_permission('documents.create')) with check (public.has_permission('documents.create'));
create policy docv_read      on public.document_versions for select to authenticated using (public.has_permission('documents.view'));
create policy docv_ins       on public.document_versions for insert to authenticated with check (public.has_permission('documents.create'));

-- Approvals
create policy ac_read   on public.approval_chains for select to authenticated using (public.has_permission('approvals.view'));
create policy ac_write  on public.approval_chains for all to authenticated using (public.has_permission('approvals.configure')) with check (public.has_permission('approvals.configure'));
create policy as_read   on public.approval_steps for select to authenticated using (public.has_permission('approvals.view'));
create policy as_write  on public.approval_steps for all to authenticated using (public.has_permission('approvals.configure')) with check (public.has_permission('approvals.configure'));
create policy ar_read   on public.approval_requests for select to authenticated using (public.has_permission('approvals.view') or requested_by = auth.uid());
create policy ar_write  on public.approval_requests for all to authenticated using (public.has_permission('approvals.act') or requested_by = auth.uid()) with check (public.has_permission('approvals.act') or requested_by = auth.uid());
create policy aa_read   on public.approval_actions for select to authenticated using (public.has_permission('approvals.view'));
create policy aa_write  on public.approval_actions for insert to authenticated with check (public.has_permission('approvals.act'));

-- Notifications (each user sees/updates their own)
create policy notif_read   on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_upd    on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy np_read      on public.notification_prefs for select to authenticated using (user_id = auth.uid());
create policy np_write     on public.notification_prefs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Audit log + events: read-only to the app, never writable via API.
create policy audit_read   on public.audit_log for select to authenticated using (public.has_permission('audit.view'));
create policy events_read  on public.events    for select to authenticated using (true);

-- id_sequences: no direct access needed (touched only by SECURITY DEFINER fn).
