-- ============================================================
-- Jikoni Master PRD — Seed: Kenya entity + demo data from src/data.ts
-- Values mirror the prototype exactly so the UI renders unchanged.
-- Idempotent: `on conflict do nothing` — re-runs never clobber live rows.
-- ============================================================

-- ---------- entities ----------
insert into public.entities(code, name, currency, active) values
  ('KE', 'Kenya', 'KES', true),
  ('UG', 'Uganda', 'UGX', false)   -- config exists day one; no Uganda records/logic yet (PRD scope)
on conflict (code) do nothing;

-- ---------- team ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.app_users(entity_id, name, email, role_key, role_title, two_fa, status, color)
select ke.id, v.* from ke, (values
  ('Dennis',    'dennis@ignis.africa',    'admin', 'Managing Director',        true,  'active', '#E2632A'),
  ('Brian',     'brian@ignis.africa',     'admin', 'Platform / Tech',          true,  'active', '#12A3BE'),
  ('Joan',      'joan@ignis.africa',      'fin',   'Operations',               true,  'active', '#3C8A5E'),
  ('Wilson',    'wilson@ignis.africa',    'std',   'BD — Upstream CRM',        true,  'away',   '#6D28D9'),
  ('Elizabeth', 'elizabeth@ignis.africa', 'std',   'Partnerships — Downstream',false, 'away',   '#B91C1C'),
  ('Wanjiku',   'wanjiku@ignis.africa',   'admin', 'Chief of Staff',           true,  'active', '#0e7d91'),
  ('Lily',      'lily@ignis.africa',      'view',  'Communications',           false, 'off',    '#A16207')
) as v(name, email, role_key, role_title, two_fa, status, color)
on conflict (email) do nothing;

-- ---------- per-user module permissions (initialPerms) ----------
insert into public.user_permissions(email, module, level)
select e, m, l from (values
  ('dennis@ignis.africa',    '{"finance":3,"procurement":3,"hr":3,"deploy":3,"readiness":3,"raise":3,"crm":3,"projects":3,"reports":3,"dataroom":3,"settings":3,"users":3}'::jsonb),
  ('wanjiku@ignis.africa',   '{"finance":3,"procurement":3,"hr":3,"deploy":3,"readiness":3,"raise":3,"crm":3,"projects":3,"reports":3,"dataroom":3,"settings":3,"users":3}'::jsonb),
  ('brian@ignis.africa',     '{"finance":1,"procurement":1,"hr":1,"deploy":3,"readiness":2,"raise":1,"crm":1,"projects":2,"reports":2,"dataroom":1,"settings":3,"users":3}'::jsonb),
  ('joan@ignis.africa',      '{"finance":3,"procurement":3,"hr":2,"deploy":1,"readiness":1,"raise":0,"crm":1,"projects":2,"reports":2,"dataroom":0,"settings":0,"users":0}'::jsonb),
  ('wilson@ignis.africa',    '{"finance":0,"procurement":0,"hr":0,"deploy":1,"readiness":1,"raise":2,"crm":3,"projects":1,"reports":1,"dataroom":0,"settings":0,"users":0}'::jsonb),
  ('elizabeth@ignis.africa', '{"finance":0,"procurement":0,"hr":0,"deploy":1,"readiness":2,"raise":0,"crm":3,"projects":1,"reports":1,"dataroom":0,"settings":0,"users":0}'::jsonb),
  ('lily@ignis.africa',      '{"finance":0,"procurement":0,"hr":0,"deploy":1,"readiness":0,"raise":0,"crm":1,"projects":0,"reports":1,"dataroom":0,"settings":0,"users":0}'::jsonb)
) as p(e, perms), lateral (select key as m, value::text::int as l from jsonb_each(perms)) kv
on conflict (email, module) do nothing;

-- ---------- chart of accounts (minimal Kenya COA) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.chart_of_accounts(entity_id, code, name, kind)
select ke.id, v.* from ke, (values
  ('1000', 'Cash & bank',                    'asset'),
  ('1100', 'Accounts receivable',            'asset'),
  ('1200', 'Inventory',                      'asset'),
  ('2000', 'Accounts payable',               'liability'),
  ('2100', 'VAT payable',                    'liability'),
  ('3000', 'Capital & reserves',             'equity'),
  ('4000', 'Sales & programme income',       'income'),
  ('5000', 'Programme & operating expenses', 'expense')
) as v(code, name, kind)
on conflict (entity_id, code) do nothing;

-- ---------- budget lines (data.ts budgetLines; u seeded as actual spend) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.budget_lines(entity_id, code, budget, committed, actual)
select ke.id, v.* from ke, (values
  ('Deployment',              1500000, 0, 1110000),
  ('Operations',               800000, 0,  488000),
  ('Field / MRV',              900000, 0,  432000),
  ('BD / Fundraise',           700000, 0,  385000),
  ('Admin',                    500000, 0,  300000),
  ('Project · Makueni VTC',   3200000, 0, 1900000),
  ('Project · Sierra Leone',  1300000, 0,  330000)
) as v(code, budget, committed, actual)
on conflict (code) do nothing;

-- ---------- approval matrix (Kenya SOP defaults; mirrors reqRouting) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.approval_matrix(entity_id, sort, max_amount, label, who, result_state)
select ke.id, v.* from ke, (values
  (1, 4999.99::numeric, 'Auto-approved',   'clears without a signature',   'approved'),
  (2, 100000::numeric,  'Single approver', 'routes to Joan (Operations)',  'submitted'),
  (3, 500000::numeric,  'Dual approval',   'Joan, then Dennis',            'submitted'),
  (4, null::numeric,    'MD sign-off',     'routes to Dennis (MD)',        'md_review')
) as v(sort, max_amount, label, who, result_state)
where not exists (select 1 from public.approval_matrix);

-- ---------- vendors (vendorDetails) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.vendors(entity_id, name, category, country, rating, tax_status, screen_status, bank, since, spend_txt, open_pos, timeline, contracts, docs, state)
select ke.id, v.* from ke, (values
  ('BURN Manufacturing', 'Cookstoves', 'Kenya', '4.8', 'Compliant', 'cleared', 'KCB ****4021', 'Jan 2025', 'KES 3.9M', 1,
   $j$[{"d":"Today","ev":"Delivery","note":"PO-059 partial delivery (60%) received; GRN-074 open pending the balance."},
       {"d":"2 weeks ago","ev":"PO issued","note":"PO-059 — cooker batch, KES 640,000."},
       {"d":"Mar 2026","ev":"Framework signed","note":"Cookstove supply framework agreed at fixed rates through Dec 2026."},
       {"d":"Jan 2025","ev":"Onboarded","note":"Registered, tax-verified and sanctions-screened — cleared."}]$j$::jsonb,
   $j$[{"name":"Cookstove supply framework","type":"Framework · agreed rates","expiry":"Dec 2026","status":"Active"}]$j$::jsonb,
   $j$["Cookstove supply framework (signed)","Certificate of incorporation","KRA PIN certificate","Tax Compliance Certificate","PO-059","GRN-074","Invoice INV-2291"]$j$::jsonb,
   'active'),
  ('Nakuru Fabricators', 'Fabrication', 'Kenya', '4.4', 'Compliant', 'cleared', 'Equity ****7712', 'Jun 2025', 'KES 0.9M', 1,
   $j$[{"d":"This week","ev":"PO issued","note":"PO-061 — cooker spares, KES 142,000, due 8 Jul."},
       {"d":"This week","ev":"Awarded","note":"Won RFQ-014 (score 92) — best value on lead time."},
       {"d":"Jun 2025","ev":"Onboarded","note":"Registered, tax-verified and sanctions-screened."}]$j$::jsonb,
   '[]'::jsonb,
   $j$["RFQ-014 quote","KRA PIN certificate","Tax Compliance Certificate","PO-061"]$j$::jsonb,
   'active'),
  ('Equity Logistics', 'Transport', 'Kenya', '4.2', 'Compliant', 'cleared', 'Equity ****3390', 'Feb 2025', 'KES 1.4M', 0,
   $j$[{"d":"2 weeks ago","ev":"Delivered","note":"PO-058 delivered in full; GRN-073 matched and closed."},
       {"d":"Mar 2026","ev":"Framework signed","note":"Logistics framework agreed through Mar 2027."},
       {"d":"Feb 2025","ev":"Onboarded","note":"Screened and approved."}]$j$::jsonb,
   $j$[{"name":"Logistics framework","type":"Framework","expiry":"Mar 2027","status":"Active"}]$j$::jsonb,
   $j$["Logistics framework (signed)","KRA PIN certificate","Tax Compliance Certificate","PO-058","GRN-073"]$j$::jsonb,
   'active'),
  ('Safaricom', 'Telecoms / data', 'Kenya', '4.6', 'Compliant', 'cleared', '—', '2024', 'KES 0.3M', 0,
   $j$[{"d":"Recent","ev":"Match variance","note":"INV-2284 flagged — quantity mismatch vs PO-056; payment held pending resolution."},
       {"d":"Sep 2025","ev":"Service agreement","note":"Data & connectivity agreement signed."}]$j$::jsonb,
   $j$[{"name":"Data & connectivity","type":"Service agreement","expiry":"Sep 2026","status":"Renew soon"}]$j$::jsonb,
   $j$["Data & connectivity agreement","KRA PIN certificate","PO-056","Invoice INV-2284 (disputed)"]$j$::jsonb,
   'active'),
  ('Mombasa Freight Co.', 'Clearing', 'Kenya', '—', 'Pending PIN', 'in_screening', '—', 'Onboarding', 'KES 0', 0,
   $j$[{"d":"This week","ev":"Onboarding","note":"Registration submitted; awaiting KRA PIN and sanctions screening before any award can be made."}]$j$::jsonb,
   '[]'::jsonb,
   $j$["Registration form (submitted)"]$j$::jsonb,
   'in_screening')
) as v(name, category, country, rating, tax_status, screen_status, bank, since, spend_txt, open_pos, timeline, contracts, docs, state)
on conflict (name) do nothing;

-- screening sub-records for cleared vendors
insert into public.vendor_screenings(vendor_id, result, notes)
select id, 'cleared', 'Sanctions & PEP screening — no matches'
from public.vendors v where screen_status = 'cleared'
  and not exists (select 1 from public.vendor_screenings s where s.vendor_id = v.id);

-- ---------- reference counters (prototype sequence continuity) ----------
insert into public.ref_counters(kind, prefix, n) values
  ('PR',  'PR-',   208),
  ('PO',  'PO-',   61),
  ('SI',  'SI-0',  188),
  ('TSK', 'TSK-',  210),
  ('GRN', 'GRN-',  74),
  ('INV', 'INV-',  2291),
  ('PAY', 'PAY-',  100),
  ('JE',  'JE-',   100)
on conflict (kind) do nothing;

-- ---------- My Week tasks (initialMyWeek; created_at staggered to keep order) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.tasks(ref, entity_id, title, sub, owner_name, due_pill, due_label, created_at)
select v.ref, ke.id, v.title, v.sub, v.owner_name, v.due_pill, v.due_label,
       now() - (v.ord || ' minutes')::interval
from ke, (values
  (1, 'ENG-002', 'IEA — confirm DSA signed, share Excel dataset', 'Wilson copied', 'Wanjiku', 'over', 'Overdue'),
  (2, 'ENG-026', 'SEforALL — send Ethiopia ONStove brief', '', 'Wanjiku', 'over', 'Overdue'),
  (3, 'ENG-021', 'OSECC — lock 30-min call with Benson', '', 'Wanjiku', 'today', 'Today'),
  (4, 'PCV-114', 'Petty cash replenishment — approve Joan''s float', 'KES 48,200', 'Wanjiku', 'today', 'Today'),
  (5, 'ENG-029', 'Rockefeller — lock call with Betty', '', 'Wanjiku', 'week', 'This week'),
  (6, 'BRD-Q2', 'Q2 board pack — review before circulation', '', 'Wanjiku', 'week', 'This week'),
  (7, 'TSK-206', 'Makueni VTC — confirm 22 platform registrations', '', 'Elizabeth', 'today', 'Today'),
  (8, 'TSK-207', 'Cooker spares — raise PO for maintenance batch', '', 'Joan', 'week', 'This week'),
  (9, 'TSK-208', 'Stanbic Uganda — draft MOU redlines', '', 'Wilson', 'week', 'This week')
) as v(ord, ref, title, sub, owner_name, due_pill, due_label)
on conflict (ref) do nothing;

-- ---------- CRM engagements (crmData) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.engagements(ref, entity_id, name, stage, owner_name, pill, pill_txt, pipeline)
select v.ref, ke.id, v.name, v.stage, v.owner_name, v.pill, v.pill_txt, v.pipeline from ke, (values
  ('ENG-002', 'IEA',                          'Materials',      'Wilson',    'over',  'Overdue',   'up'),
  ('ENG-008', 'EAIF',                         'Negotiation',    'Wilson',    'today', 'Today',     'up'),
  ('ENG-012', 'Charm Impact',                 'Term sheet',     'Wilson',    'week',  'This week', 'up'),
  ('ENG-019', 'Cygnum Capital',               'Discovery',      'Wilson',    'week',  'This week', 'up'),
  ('ENG-026', 'SEforALL',                     'Materials',      'Wilson',    'over',  'Overdue',   'up'),
  ('ENG-029', 'Rockefeller',                  'Discovery',      'Wilson',    'week',  'This week', 'up'),
  ('DST-004', 'Makueni County VTCs',          'Contracting',    'Elizabeth', 'today', 'Today',     'down'),
  ('DST-007', 'CLASP',                        'Site visit',     'Elizabeth', 'week',  'This week', 'down'),
  ('DST-011', 'Catholic Diocese — Machakos',  'EOI',            'Elizabeth', 'week',  'This week', 'down'),
  ('DST-015', 'BURN Manufacturing',           'Identification', 'Elizabeth', 'done',  'Logged',    'down'),
  ('DST-018', 'Kiambu institutions cluster',  'Site visit',     'Elizabeth', 'over',  'Overdue',   'down')
) as v(ref, name, stage, owner_name, pill, pill_txt, pipeline)
on conflict (ref) do nothing;

-- ---------- projects (initialProjectDetails) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.projects(entity_id, name, funder, status, budget_txt, spent_txt, pct, timeline, team, reporting, field, milestones, drawdowns, docs, is_extra, state)
select ke.id, v.* from ke, (values
  ('Makueni VTC rollout', 'Makueni County + grant', 'On track', 'KES 3.2M', 'KES 1.9M', '59%', 'Jan–Dec 2026', 'Elizabeth · field crew',
   'Quarterly · next 15 Jul', '48 site visits · 22 installs logged',
   $j$[{"t":"Phase 1 — 22 institutions onboarded","s":"done"},{"t":"Phase 2 — platform registration (63)","s":"now"},{"t":"Phase 3 — full deployment","s":"todo"}]$j$::jsonb,
   $j$[{"t":"Tranche 1","v":"KES 1.2M","s":"Received"},{"t":"Tranche 2","v":"KES 1.0M","s":"On milestone 2"}]$j$::jsonb,
   $j$["Grant agreement","MoU — Makueni County","Q1 narrative report","M&E framework"]$j$::jsonb,
   false, 'active'),
  ('Sierra Leone (PICREF)', 'PICREF grant', 'Drawdown due', '$240k', '$61k', '25%', '2026', 'Wilson · partner',
   'Inception report · Aug', '—',
   $j$[{"t":"Proposal accepted (PICREF)","s":"done"},{"t":"Site selection sign-off","s":"now"},{"t":"Inception report","s":"todo"}]$j$::jsonb,
   $j$[{"t":"Inception tranche","v":"$61k","s":"Received"},{"t":"Tranche 2","v":"$80k","s":"Requested"}]$j$::jsonb,
   $j$["PICREF grant agreement","Proposal (submitted)","Budget"]$j$::jsonb,
   false, 'active'),
  ('Kiambu cluster', 'Blended', 'On track', 'KES 1.8M', 'KES 1.1M', '61%', '2026', 'Elizabeth · enumerators',
   'Quarterly', 'Readiness assessments complete',
   $j$[{"t":"Site visits complete","s":"done"},{"t":"Contracting","s":"now"},{"t":"Deployment","s":"todo"}]$j$::jsonb,
   $j$[{"t":"Tranche 1","v":"KES 1.1M","s":"Received"}]$j$::jsonb,
   $j$["Agreement","Readiness scoring pack"]$j$::jsonb,
   false, 'active'),
  ('5-County data collection', 'CCIQ / grant', 'Active', 'KES 2.1M', 'KES 1.4M', '67%', '2026', '12 enumerators',
   'Mid-term review · Sep', '214 assessments · 5 counties',
   $j$[{"t":"Enumerators recruited & trained","s":"done"},{"t":"Baseline data — 5 counties","s":"now"},{"t":"Analysis & report","s":"todo"}]$j$::jsonb,
   $j$[{"t":"Grant tranche 1","v":"KES 1.4M","s":"Received"}]$j$::jsonb,
   $j$["Data-collection grant","KoboToolbox XLSForm","Enumerator rubric"]$j$::jsonb,
   false, 'active'),
  ('EPC 5-site pilot', 'Grant', 'Active', '$19.8k', '$6k', '30%', '2026', 'Field team',
   'Pilot report', 'Installs underway',
   $j$[{"t":"5 sites selected","s":"done"},{"t":"Installation","s":"now"},{"t":"Monitoring & report","s":"todo"}]$j$::jsonb,
   $j$[{"t":"Tranche 1","v":"$6k","s":"Received"},{"t":"Tranche 2","v":"$8k","s":"On milestone"}]$j$::jsonb,
   $j$["EPC pilot grant budget","Pilot plan"]$j$::jsonb,
   false, 'active')
) as v(name, funder, status, budget_txt, spent_txt, pct, timeline, team, reporting, field, milestones, drawdowns, docs, is_extra, state)
on conflict (name) do nothing;

-- ---------- engagement ↔ project links (initialEngToProject / initialProjectToEng) ----------
insert into public.eng_project_links(eng_ref, project_name, is_primary) values
  ('DST-004', 'Makueni VTC rollout', true),
  ('DST-018', 'Kiambu cluster',      true),
  ('DST-011', 'Makueni VTC rollout', false)
on conflict (eng_ref) do nothing;

-- ---------- bank & petty cash ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.bank_accounts(entity_id, name, number_mask, balance)
select ke.id, 'KCB — operating account', 'KCB ****4021', 4200000 from ke
where not exists (select 1 from public.bank_accounts);

with ke as (select id from public.entities where code = 'KE')
insert into public.petty_cash_floats(entity_id, custodian, balance)
select ke.id, 'Joan', 48200 from ke
where not exists (select 1 from public.petty_cash_floats);
