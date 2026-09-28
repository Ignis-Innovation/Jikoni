-- ============================================================
-- 0089 — General Ledger (Jikoni_General_Ledger_Guide_and_Spec, Sept 2026)
-- Builds the GL described in the spec (Part B) with the Part C defaults:
--   D1 fund code on every journal line (optional; defaults from the project's fund)
--   D2 opening balances = one authorised, locked opening journal
--   D3 FX gain/loss account; USD receipts post the difference at the receipt rate
--   D4 M-Pesa is its own reconcilable account (1010), never merged into bank
--   D5 manual journals follow the IGN-FIN-001 bands (configurable)
--
-- Pieces:
--   · chart of accounts: + reconcilable / manual_allowed flags, new accounts
--   · gl_funds, gl_mappings (configurable account mapping), gl_periods
--   · post_journal v2 — the ONE posting engine: balanced, accounts must exist,
--     no duplicate source key, closed periods rejected, every line coded
--     (project / cost centre / fund), dated + period-stamped. Internal only.
--   · gl_acct(event, role) — the mapping lookup every module posts through
--   · manual journals (draft → submitted → approved/posted | rejected), opening
--     balances, reversals — all through the same approval path
--   · period workflow Open → Reconciled → TB agreed → Closed → Reported
--   · bank / M-Pesa / petty-cash reconciliation with statement lines
--   · reports: trial balance, P&L, balance sheet, account ledger, project actuals
-- Module postings (existing posters re-pointed at the mapping + new triggers for
-- petty cash, claims, travel advances, recurring bills) are in 0090.
-- Idempotent.
-- ============================================================

-- ---------- chart of accounts ----------
alter table public.chart_of_accounts
  add column if not exists reconcilable   boolean not null default false,
  add column if not exists manual_allowed boolean not null default true,
  add column if not exists description    text;

insert into public.chart_of_accounts(entity_id, code, name, kind)
select e.id, v.code, v.name, v.kind
from public.entities e,
     (values
       ('1010','M-Pesa','asset'),
       ('1020','Petty cash float','asset'),
       ('1150','Employee advances','asset'),
       ('1160','Prepayments','asset'),
       ('2050','Accruals','liability'),
       ('3100','Retained earnings','equity'),
       ('3900','Opening balance equity','equity'),
       ('4100','Grant income','income'),
       ('4900','Foreign exchange gain / (loss)','income'),
       ('5100','Travel & accommodation','expense'),
       ('5110','Transport & fuel','expense'),
       ('5120','Meals & per diem','expense'),
       ('5130','Communication & airtime','expense'),
       ('5140','Supplies & office','expense'),
       ('5160','Utilities & recurring bills','expense')
     ) as v(code, name, kind)
where e.code = 'KE'
on conflict (entity_id, code) do nothing;

update public.chart_of_accounts set name = 'Bank — KCB' where code = '1000' and name = 'Cash & bank';
update public.chart_of_accounts set reconcilable = true where code in ('1000','1010','1020');
-- control accounts are fed by their subledgers, not by hand (opening journals excepted)
update public.chart_of_accounts set manual_allowed = false where code in ('1100','2000','1150');

-- ---------- funds (D1) ----------
create table if not exists public.gl_funds (
  code       text primary key,
  name       text not null,
  donor      text,
  restricted boolean not null default true,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.gl_funds(code, name, donor, restricted) values
  ('GEN',  'General / unrestricted', null, false),
  ('FSD',  'FSD Africa',             'FSD Africa', true),
  ('UNDP', 'UNDP',                   'UNDP', true),
  ('IRENA','IRENA',                  'IRENA', true),
  ('PA',   'Practical Action',       'Practical Action', true)
on conflict (code) do nothing;
alter table public.projects add column if not exists fund_code text references public.gl_funds(code) on delete set null;

-- ---------- journal header / line additions ----------
alter table public.journal_entries
  add column if not exists entry_date  date,
  add column if not exists period      text,
  add column if not exists kind        text not null default 'auto',
  add column if not exists source_key  text,
  add column if not exists reversal_of text,
  add column if not exists reversed_by text,
  add column if not exists posted_by   uuid references public.app_users(id);
update public.journal_entries
   set entry_date = (created_at at time zone 'Africa/Nairobi')::date
 where entry_date is null;
update public.journal_entries set period = to_char(entry_date, 'YYYY-MM') where period is null;
alter table public.journal_entries alter column entry_date set default public.ke_today();
create unique index if not exists journal_entries_source_key_uq on public.journal_entries(source_key) where source_key is not null;
create index if not exists journal_entries_period_idx on public.journal_entries(period);
do $$ begin
  alter table public.journal_entries drop constraint if exists journal_entries_kind_check;
  alter table public.journal_entries add constraint journal_entries_kind_check check (kind in ('auto','manual','opening','reversal'));
end $$;

alter table public.journal_lines
  add column if not exists project_code text,
  add column if not exists cost_centre  text,
  add column if not exists fund_code    text,
  add column if not exists memo         text;
create index if not exists journal_lines_account_idx on public.journal_lines(account_code);
create index if not exists journal_lines_project_idx on public.journal_lines(project_code);

-- ---------- account mappings (spec §8: configuration, not code) ----------
create table if not exists public.gl_mappings (
  event        text not null,
  role         text not null,
  account_code text not null,
  label        text,
  updated_at   timestamptz not null default now(),
  primary key (event, role)
);
insert into public.gl_mappings(event, role, account_code, label) values
  ('sales_invoice','receivable','1100','Customer invoice — receivable'),
  ('sales_invoice','revenue','4000','Customer invoice — revenue'),
  ('sales_invoice','vat','2100','Customer invoice — output VAT'),
  ('ar_receipt','bank','1000','Customer payment by bank / cheque'),
  ('ar_receipt','mpesa','1010','Customer payment by M-Pesa'),
  ('ar_receipt','receivable','1100','Customer payment — receivable cleared'),
  ('ar_receipt','fx','4900','USD receipt — exchange difference'),
  ('ap_invoice','expense','5000','Supplier invoice — expense (when the cost centre has no account)'),
  ('ap_invoice','payable','2000','Supplier invoice — payable'),
  ('ap_payment','payable','2000','Supplier payment — payable cleared'),
  ('ap_payment','bank','1000','Supplier payment by bank'),
  ('ap_payment','mpesa','1010','Supplier payment by M-Pesa'),
  ('ap_payment','wht','2200','Supplier payment — withholding tax'),
  ('payroll','expense','5200','Payroll — gross + employer costs'),
  ('payroll','paye','2210','Payroll — PAYE'),
  ('payroll','nssf','2220','Payroll — NSSF'),
  ('payroll','shif','2230','Payroll — SHIF'),
  ('payroll','housing','2240','Payroll — Housing Levy'),
  ('payroll','net','2250','Payroll — net pay'),
  ('depreciation','expense','5150','Depreciation — expense'),
  ('depreciation','accumulated','1250','Depreciation — accumulated'),
  ('petty_cash','expense','5000','Petty cash — expense'),
  ('petty_cash','cash','1020','Petty cash — float paid out'),
  ('expense_claim','transport','5110','Claim — transport'),
  ('expense_claim','accommodation','5100','Claim — accommodation'),
  ('expense_claim','meals','5120','Claim — meals'),
  ('expense_claim','per_diem','5120','Claim — per diem'),
  ('expense_claim','airtime','5130','Claim — airtime'),
  ('expense_claim','supplies','5140','Claim — supplies'),
  ('expense_claim','other','5000','Claim — other'),
  ('expense_claim','bank','1000','Claim — reimbursed from'),
  ('travel_advance','advances','1150','Travel advance — employee advances'),
  ('travel_advance','bank','1000','Travel advance — paid out / returned'),
  ('travel_advance','transport','5110','Advance spend — transport'),
  ('travel_advance','accommodation','5100','Advance spend — accommodation'),
  ('travel_advance','meals','5120','Advance spend — meals'),
  ('travel_advance','per_diem','5120','Advance spend — per diem'),
  ('travel_advance','airtime','5130','Advance spend — airtime'),
  ('travel_advance','supplies','5140','Advance spend — supplies'),
  ('travel_advance','other','5000','Advance spend — other'),
  ('recurring_bill','expense','5160','Recurring bill — expense'),
  ('recurring_bill','bank','1000','Recurring bill — paid from'),
  ('opening','equity','3900','Opening balances — balancing equity')
on conflict (event, role) do nothing;

create or replace function public.gl_acct(p_event text, p_role text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select account_code into v from public.gl_mappings where event = p_event and role = p_role;
  if v is null then
    raise exception 'No ledger account is mapped for % / % — set it in Finance → General Ledger → Mappings', p_event, p_role;
  end if;
  return v;
end $$;

-- ---------- periods ----------
create table if not exists public.gl_periods (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid references public.entities(id),
  period      text not null check (period ~ '^\d{4}-\d{2}$'),
  state       text not null default 'open' check (state in ('open','reconciled','tb_agreed','closed','reported')),
  reconciled_by uuid references public.app_users(id), reconciled_at timestamptz,
  tb_agreed_by  uuid references public.app_users(id), tb_agreed_at  timestamptz,
  closed_by     uuid references public.app_users(id), closed_at     timestamptz,
  reported_by   uuid references public.app_users(id), reported_at   timestamptz,
  created_at  timestamptz not null default now(),
  unique (entity_id, period)
);

create or replace function public.gl_period_state(p_period text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select state from public.gl_periods
                    where period = p_period and entity_id = (select id from public.entities where code = 'KE')), 'open')
$$;

-- posting into a period: create it (open) on first use; refuse closed/reported
create or replace function public.gl_assert_open(p_date date) returns text
language plpgsql security definer set search_path = public as $$
declare v_p text := to_char(p_date, 'YYYY-MM'); v_state text;
begin
  insert into public.gl_periods(entity_id, period)
  values ((select id from public.entities where code = 'KE'), v_p)
  on conflict (entity_id, period) do nothing;
  v_state := public.gl_period_state(v_p);
  if v_state in ('closed','reported') then
    raise exception 'The % accounting period is closed — post this in an open period (corrections go in as a dated adjustment)', v_p;
  end if;
  return v_p;
end $$;

-- ---------- the posting engine (spec §2, §6, §13) ----------
drop function if exists public.post_journal(text, text, text, jsonb);
create or replace function public.post_journal(
  p_memo text, p_source_type text, p_source_ref text, p_lines jsonb,
  p_date date default null, p_key text default null, p_kind text default 'auto', p_coding jsonb default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_id uuid; l jsonb; acc record;
  v_debits numeric := 0; v_credits numeric := 0; v_dr numeric; v_cr numeric;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_date date := coalesce(p_date, public.ke_today());
  v_period text;
  v_proj text; v_cc text; v_fund text;
  v_default_cc text := coalesce((select value #>> '{}' from public.app_config where key = 'gl_default_cost_centre'), 'HQ');
  v_lines jsonb := '[]'::jsonb;
begin
  if p_key is not null and exists (select 1 from public.journal_entries where source_key = p_key) then
    raise exception 'Already posted to the ledger (%) — a source transaction posts once', p_key;
  end if;
  v_period := public.gl_assert_open(v_date);

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_dr := round(coalesce(nullif(l->>'debit','')::numeric, 0), 2);
    v_cr := round(coalesce(nullif(l->>'credit','')::numeric, 0), 2);
    if v_dr < 0 or v_cr < 0 then raise exception 'Journal amounts cannot be negative'; end if;
    if v_dr > 0 and v_cr > 0 then raise exception 'A journal line is either a debit or a credit, not both'; end if;
    if v_dr = 0 and v_cr = 0 then continue; end if;
    select * into acc from public.chart_of_accounts
     where code = l->>'account' and entity_id = v_entity;
    if not found then raise exception 'Account % is not in the chart of accounts', coalesce(l->>'account', '(blank)'); end if;
    if not acc.active then raise exception 'Account % % is inactive', acc.code, acc.name; end if;
    v_proj := nullif(trim(coalesce(l->>'project', p_coding->>'project', '')), '');
    v_cc   := nullif(trim(coalesce(l->>'costCentre', p_coding->>'costCentre', '')), '');
    v_fund := nullif(trim(coalesce(l->>'fund', p_coding->>'fund', '')), '');
    if v_fund is null and v_proj is not null then
      select fund_code into v_fund from public.projects where name = v_proj;
    end if;
    if v_fund is not null and not exists (select 1 from public.gl_funds where code = v_fund and active) then
      raise exception 'Fund % is not set up', v_fund;
    end if;
    -- complete coding: income / expense lines always land on a project or cost centre
    if acc.kind in ('income','expense') and v_proj is null and v_cc is null then v_cc := v_default_cc; end if;
    v_debits := v_debits + v_dr; v_credits := v_credits + v_cr;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('a', acc.code, 'd', v_dr, 'c', v_cr,
      'p', v_proj, 'cc', v_cc, 'f', v_fund, 'm', nullif(trim(coalesce(l->>'memo','')), '')));
  end loop;
  if v_debits = 0 then raise exception 'A journal needs at least one amount'; end if;
  if v_debits <> v_credits then
    raise exception 'Journal must balance (debits % vs credits %)', v_debits, v_credits;
  end if;

  v_ref := public.next_ref('JE');
  insert into public.journal_entries(ref, entity_id, memo, source_type, source_ref, entry_date, period, kind, source_key, posted_by)
  values (v_ref, v_entity, p_memo, p_source_type, p_source_ref, v_date, v_period, coalesce(p_kind, 'auto'), p_key,
          (select id from public.app_users where auth_id = auth.uid()))
  returning id into v_id;
  insert into public.journal_lines(journal_id, account_code, debit, credit, project_code, cost_centre, fund_code, memo)
  select v_id, x->>'a', (x->>'d')::numeric, (x->>'c')::numeric, x->>'p', x->>'cc', x->>'f', x->>'m'
  from jsonb_array_elements(v_lines) x;
  perform public.audit_write('journal.posted','journal_entry', v_ref,
    jsonb_build_object('memo', p_memo, 'source', p_source_type, 'sourceRef', p_source_ref, 'amount', v_debits,
                       'date', v_date, 'kind', coalesce(p_kind,'auto')));
  return v_ref;
end $$;
-- internal: only other (security definer) RPCs may post
revoke execute on function public.post_journal(text, text, text, jsonb, date, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.gl_assert_open(date) from public, anon, authenticated;
revoke execute on function public.gl_acct(text, text) from public, anon, authenticated;

-- posted entries are never edited or deleted (corrections are reversals)
create or replace function public.journal_immutable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('jikoni.allow_journal_delete', true) = 'on' then return old; end if;
    raise exception 'Posted journal entries cannot be deleted — reverse them instead';
  end if;
  if tg_table_name = 'journal_lines' then
    raise exception 'Posted journal lines cannot be edited — reverse the entry instead';
  end if;
  -- header: only the reversal bookkeeping may change
  if (new.ref, new.memo, new.source_type, new.source_ref, new.entry_date, new.period, new.kind, new.source_key)
     is distinct from (old.ref, old.memo, old.source_type, old.source_ref, old.entry_date, old.period, old.kind, old.source_key) then
    raise exception 'Posted journal entries cannot be edited — reverse the entry instead';
  end if;
  return new;
end $$;
drop trigger if exists journal_entries_immutable on public.journal_entries;
create trigger journal_entries_immutable before update or delete on public.journal_entries
  for each row execute function public.journal_immutable();
drop trigger if exists journal_lines_immutable on public.journal_lines;
create trigger journal_lines_immutable before update or delete on public.journal_lines
  for each row execute function public.journal_immutable();

-- ---------- settings keys ----------
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
    'per_diem_daily_rate',
    'invoice_bank_usd','invoice_bank_kes','invoice_from','invoice_default_notes',
    'invoice_payment_note','invoice_vat_rates','usd_kes_rate','invoice_terms_conditions',
    'usd_kes_rate_auto','usd_kes_rate_updated',
    'gl_journal_bands','gl_approvers','gl_default_cost_centre'
  ) then
    raise exception 'Unknown setting: %', p_key;
  end if;
  insert into public.app_config(key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit_write('config.updated','app_config', p_key, jsonb_build_object('value', p_value));
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

-- IGN-FIN-001 bands (D5). Each band lists approval "slots"; each slot is filled by one
-- approver holding one of the listed authorities. A higher authority may fill a lower slot.
insert into public.app_config(key, value) values
  ('gl_journal_bands', '[
     {"max": 5000,    "label": "Line Manager (to KES 5,000)",            "slots": [["line_manager","chief_of_staff","md","board"]]},
     {"max": 20000,   "label": "Chief of Staff (5,001 – 20,000)",        "slots": [["chief_of_staff","md","board"]]},
     {"max": 500000,  "label": "MD (20,001 – 500,000)",                  "slots": [["md","board"]]},
     {"max": 2000000, "label": "MD + one Board member (to 2,000,000)",   "slots": [["md"],["board"]]},
     {"max": null,    "label": "Board (above 2,000,000)",                "slots": [["board"],["board"]]}
   ]'),
  ('gl_approvers', '{"dnderitu@ignis-innovation.com": "md"}'),
  ('gl_default_cost_centre', '"HQ"')
on conflict (key) do nothing;

-- ---------- manual journals (spec §4, D2, D5) ----------
create table if not exists public.manual_journals (
  id           uuid primary key default gen_random_uuid(),
  ref          text unique not null,
  entity_id    uuid references public.entities(id),
  kind         text not null default 'manual' check (kind in ('manual','opening','reversal')),
  entry_date   date not null default public.ke_today(),
  memo         text,
  lines        jsonb not null default '[]'::jsonb,   -- [{account, debit, credit, project, costCentre, fund, memo}]
  total        numeric(16,2) not null default 0,
  attachments  text[] not null default '{}',
  state        text not null default 'draft' check (state in ('draft','submitted','posted','rejected')),
  band_label   text,
  slots        jsonb,                                 -- required approval slots, snapshotted at submit
  approvals    jsonb not null default '[]'::jsonb,    -- [{email, name, authority, at}]
  reversal_of  text,                                  -- JE ref being reversed (kind = reversal)
  je_ref       text,
  created_by   uuid references public.app_users(id),
  submitted_at timestamptz,
  rejected_by  uuid references public.app_users(id),
  reject_reason text,
  posted_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
insert into public.ref_counters(kind, prefix, n) values ('MJ', 'MJ-', 0) on conflict (kind) do nothing;

create or replace function public.gl_my_authority() returns text
language sql stable security definer set search_path = public as $$
  select (select value from public.app_config where key = 'gl_approvers')
         ->> lower((select email from public.app_users where auth_id = auth.uid()))
$$;

create or replace function public.mj_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'ref', m.ref, 'kind', m.kind, 'date', m.entry_date, 'memo', m.memo, 'lines', m.lines,
    'total', m.total, 'attachments', to_jsonb(m.attachments), 'state', m.state, 'bandLabel', m.band_label,
    'slots', m.slots, 'approvals', m.approvals, 'reversalOf', m.reversal_of, 'jeRef', m.je_ref,
    'createdBy', u.name, 'createdByEmail', lower(u.email), 'submittedAt', m.submitted_at,
    'rejectReason', m.reject_reason, 'rejectedBy', rj.name, 'postedAt', m.posted_at, 'createdAt', m.created_at)
  from public.manual_journals m
  left join public.app_users u on u.id = m.created_by
  left join public.app_users rj on rj.id = m.rejected_by
  where m.id = p_id
$$;

-- validate lines → returns total; p_strict applies submit-time rules
create or replace function public.mj_check_lines(p_kind text, p_lines jsonb, p_strict boolean) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare l jsonb; acc record; v_dr numeric := 0; v_cr numeric := 0; d numeric; c numeric; n int := 0;
        v_entity uuid := (select id from public.entities where code = 'KE');
begin
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    d := coalesce(nullif(l->>'debit','')::numeric, 0); c := coalesce(nullif(l->>'credit','')::numeric, 0);
    if coalesce(l->>'account','') = '' and d = 0 and c = 0 then continue; end if;
    if d < 0 or c < 0 then raise exception 'Journal amounts cannot be negative'; end if;
    if d > 0 and c > 0 then raise exception 'Each line is either a debit or a credit, not both'; end if;
    select * into acc from public.chart_of_accounts where code = l->>'account' and entity_id = v_entity;
    if not found then raise exception 'Pick an account for every line (% is not in the chart)', coalesce(nullif(l->>'account',''), 'blank'); end if;
    if p_kind = 'manual' and not acc.manual_allowed then
      raise exception '% % is a control account — it is posted by its module, not by a manual journal', acc.code, acc.name;
    end if;
    v_dr := v_dr + d; v_cr := v_cr + c; n := n + 1;
  end loop;
  if p_strict then
    if n < 2 then raise exception 'A journal needs at least two lines'; end if;
    if v_dr = 0 then raise exception 'Enter the amounts'; end if;
    if round(v_dr, 2) <> round(v_cr, 2) then
      raise exception 'Debits (%) and credits (%) must be equal', to_char(v_dr, 'FM999,999,999,990.00'), to_char(v_cr, 'FM999,999,999,990.00');
    end if;
  end if;
  return round(v_dr, 2);
end $$;

create or replace function public.save_manual_journal(p_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; m record; v_kind text := coalesce(nullif(p_data->>'kind',''), 'manual'); v_total numeric;
        v_me uuid := (select id from public.app_users where auth_id = auth.uid());
        v_date date := coalesce(nullif(p_data->>'date','')::date, public.ke_today());
        v_paths text[];
begin
  perform public.assert_access('finance', 2);
  if v_kind not in ('manual','opening') then raise exception 'Unknown journal type'; end if;
  if public.gl_period_state(to_char(v_date,'YYYY-MM')) in ('closed','reported') then
    raise exception 'The % period is closed — date the journal in an open period', to_char(v_date,'YYYY-MM');
  end if;
  select coalesce(array_agg(x), '{}') into v_paths from jsonb_array_elements_text(coalesce(p_data->'attachments','[]'::jsonb)) x;
  if v_id is not null then
    select * into m from public.manual_journals where id = v_id for update;
    if not found then raise exception 'Journal not found'; end if;
    if m.state not in ('draft','rejected') then raise exception '% is % — only a draft can be edited', m.ref, m.state; end if;
    if m.kind = 'reversal' then v_kind := 'reversal'; end if;
  end if;
  v_total := public.mj_check_lines(v_kind, p_data->'lines', false);
  if v_id is null then
    insert into public.manual_journals(ref, entity_id, kind, entry_date, memo, lines, total, attachments, created_by)
    values (public.next_ref('MJ'), (select id from public.entities where code = 'KE'), v_kind, v_date,
            nullif(trim(coalesce(p_data->>'memo','')), ''), coalesce(p_data->'lines','[]'::jsonb), v_total, v_paths, v_me)
    returning id into v_id;
  else
    update public.manual_journals set
      entry_date = v_date, memo = nullif(trim(coalesce(p_data->>'memo','')), ''),
      lines = case when kind = 'reversal' then lines else coalesce(p_data->'lines','[]'::jsonb) end,
      total = case when kind = 'reversal' then total else v_total end,
      attachments = v_paths, state = 'draft', reject_reason = null, rejected_by = null,
      approvals = '[]'::jsonb, updated_at = now()
    where id = v_id;
  end if;
  select * into m from public.manual_journals where id = v_id;
  perform public.audit_write('manual_journal.saved', 'manual_journal', m.ref, jsonb_build_object('kind', m.kind, 'total', m.total));
  return public.mj_json(v_id);
end $$;

create or replace function public.submit_manual_journal(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m record; b jsonb; v_band jsonb;
begin
  perform public.assert_access('finance', 2);
  select * into m from public.manual_journals where id = p_id for update;
  if not found then raise exception 'Journal not found'; end if;
  if m.state not in ('draft','rejected') then raise exception '% is already %', m.ref, m.state; end if;
  if m.created_by is distinct from (select id from public.app_users where auth_id = auth.uid()) then
    raise exception 'Only the person who prepared % can submit it', m.ref;
  end if;
  if m.memo is null then raise exception 'Explain what the journal is for'; end if;
  if coalesce(array_length(m.attachments, 1), 0) = 0 then raise exception 'Attach the supporting document(s) before submitting'; end if;
  perform public.mj_check_lines(m.kind, m.lines, true);
  if public.gl_period_state(to_char(m.entry_date,'YYYY-MM')) in ('closed','reported') then
    raise exception 'The % period is closed — date the journal in an open period', to_char(m.entry_date,'YYYY-MM');
  end if;
  if m.kind = 'opening' and exists (select 1 from public.journal_entries where kind = 'opening') then
    raise exception 'Opening balances are already posted and locked — correct them with a normal adjusting journal';
  end if;
  for b in select * from jsonb_array_elements((select value from public.app_config where key = 'gl_journal_bands')) loop
    if (b->>'max') is null or m.total <= (b->>'max')::numeric then v_band := b; exit; end if;
  end loop;
  if v_band is null then raise exception 'No approval band covers KES %', m.total; end if;
  update public.manual_journals
     set state = 'submitted', submitted_at = now(), band_label = v_band->>'label', slots = v_band->'slots',
         approvals = '[]'::jsonb, updated_at = now()
   where id = p_id;
  -- tell the people who can approve it
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select m.entity_id, a.key, 'manual_journal_submitted', 'Journal ' || m.ref || ' needs approval',
         coalesce(m.memo,'') || ' — KES ' || to_char(m.total, 'FM999,999,990.00') || ' · ' || (v_band->>'label'), 'finance', m.ref
  from jsonb_each_text((select value from public.app_config where key = 'gl_approvers')) a
  where a.key <> lower((select email from public.app_users where id = m.created_by))
    and exists (select 1 from jsonb_array_elements(v_band->'slots') s where s ? a.value);
  perform public.audit_write('manual_journal.submitted', 'manual_journal', m.ref,
    jsonb_build_object('total', m.total, 'band', v_band->>'label'));
  return public.mj_json(p_id);
end $$;

-- fill slots greedily with the approvals given; returns number of slots still open
create or replace function public.mj_open_slots(p_slots jsonb, p_approvals jsonb) returns int
language plpgsql immutable as $$
declare s jsonb; a jsonb; used int[] := '{}'; i int; filled boolean; open_n int := 0;
begin
  for s in select * from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) loop
    filled := false; i := 0;
    for a in select * from jsonb_array_elements(coalesce(p_approvals, '[]'::jsonb)) loop
      i := i + 1;
      if not (i = any(used)) and s ? (a->>'authority') then used := used || i; filled := true; exit; end if;
    end loop;
    if not filled then open_n := open_n + 1; end if;
  end loop;
  return open_n;
end $$;

create or replace function public.approve_manual_journal(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m record; v_auth text := public.gl_my_authority(); v_email text; v_name text; v_new jsonb; v_je text;
        v_before int; v_after int;
begin
  perform public.assert_access('finance', 1);
  select lower(email), name into v_email, v_name from public.app_users where auth_id = auth.uid();
  select * into m from public.manual_journals where id = p_id for update;
  if not found then raise exception 'Journal not found'; end if;
  if m.state <> 'submitted' then raise exception '% is not awaiting approval', m.ref; end if;
  if m.created_by = (select id from public.app_users where auth_id = auth.uid()) then
    raise exception 'You prepared % — someone else must approve it', m.ref;
  end if;
  if v_auth is null then raise exception 'You are not set up as a journal approver (Finance → General Ledger → Settings)'; end if;
  if exists (select 1 from jsonb_array_elements(m.approvals) a where a->>'email' = v_email) then
    raise exception 'You have already approved %', m.ref;
  end if;
  v_before := public.mj_open_slots(m.slots, m.approvals);
  v_new := m.approvals || jsonb_build_array(jsonb_build_object('email', v_email, 'name', v_name, 'authority', v_auth, 'at', now()));
  v_after := public.mj_open_slots(m.slots, v_new);
  if v_after >= v_before then
    raise exception 'Your approval level (%) is not enough for % — it needs %', replace(v_auth, '_', ' '), m.ref, m.band_label;
  end if;
  update public.manual_journals set approvals = v_new, updated_at = now() where id = p_id;
  perform public.audit_write('manual_journal.approved', 'manual_journal', m.ref, jsonb_build_object('by', v_email, 'authority', v_auth));
  if v_after = 0 then
    if m.kind = 'opening' and exists (select 1 from public.journal_entries where kind = 'opening') then
      raise exception 'Opening balances are already posted and locked';
    end if;
    v_je := public.post_journal(
      case m.kind when 'opening' then 'Opening balances — ' when 'reversal' then 'Reversal of ' || m.reversal_of || ' — ' else '' end || coalesce(m.memo, m.ref),
      'manual_journal', m.ref, m.lines, m.entry_date, 'manual_journal:' || m.ref,
      case m.kind when 'opening' then 'opening' when 'reversal' then 'reversal' else 'manual' end, null);
    if m.kind = 'reversal' then
      update public.journal_entries set state = 'reversed', reversed_by = v_je where ref = m.reversal_of;
      update public.journal_entries set reversal_of = m.reversal_of where ref = v_je;
    end if;
    update public.manual_journals set state = 'posted', je_ref = v_je, posted_at = now(), updated_at = now() where id = p_id;
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    values (m.entity_id, lower((select email from public.app_users where id = m.created_by)), 'manual_journal_posted',
            'Journal ' || m.ref || ' posted', coalesce(m.memo,'') || ' → ' || v_je, 'finance', m.ref);
  end if;
  return public.mj_json(p_id);
end $$;

create or replace function public.reject_manual_journal(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m record;
begin
  perform public.assert_access('finance', 1);
  if nullif(trim(coalesce(p_reason,'')), '') is null then raise exception 'Give a reason for rejecting'; end if;
  if public.gl_my_authority() is null then raise exception 'You are not set up as a journal approver'; end if;
  select * into m from public.manual_journals where id = p_id for update;
  if not found then raise exception 'Journal not found'; end if;
  if m.state <> 'submitted' then raise exception '% is not awaiting approval', m.ref; end if;
  update public.manual_journals
     set state = 'rejected', reject_reason = trim(p_reason), approvals = '[]'::jsonb,
         rejected_by = (select id from public.app_users where auth_id = auth.uid()), updated_at = now()
   where id = p_id;
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  values (m.entity_id, lower((select email from public.app_users where id = m.created_by)), 'manual_journal_rejected',
          'Journal ' || m.ref || ' rejected', trim(p_reason), 'finance', m.ref);
  perform public.audit_write('manual_journal.rejected', 'manual_journal', m.ref, jsonb_build_object('reason', p_reason));
  return public.mj_json(p_id);
end $$;

create or replace function public.delete_manual_journal(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m record;
begin
  perform public.assert_access('finance', 2);
  select * into m from public.manual_journals where id = p_id;
  if not found then raise exception 'Journal not found'; end if;
  if m.state not in ('draft','rejected') then raise exception 'Only a draft or rejected journal can be deleted'; end if;
  delete from public.manual_journals where id = p_id;
  perform public.audit_write('manual_journal.deleted', 'manual_journal', m.ref, jsonb_build_object('kind', m.kind));
  return jsonb_build_object('deleted', m.ref);
end $$;

-- start a reversal: a draft journal with every line flipped, approved like any other
create or replace function public.start_journal_reversal(p_je_ref text, p_date date default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare je record; v_lines jsonb; v_total numeric; v_id uuid; v_date date := coalesce(p_date, public.ke_today());
begin
  perform public.assert_access('finance', 2);
  select * into je from public.journal_entries where ref = p_je_ref;
  if not found then raise exception 'Journal % not found', p_je_ref; end if;
  if je.kind not in ('manual','opening') then
    raise exception '% was posted by % — correct it in that module (e.g. cancel the invoice), not in the ledger', p_je_ref, coalesce(je.source_type, 'a module');
  end if;
  if je.kind = 'opening' then raise exception 'Opening balances are locked — post an adjusting journal instead'; end if;
  if je.state = 'reversed' then raise exception '% is already reversed', p_je_ref; end if;
  if exists (select 1 from public.manual_journals where reversal_of = p_je_ref and state in ('draft','submitted','rejected')) then
    raise exception 'A reversal of % is already in progress', p_je_ref;
  end if;
  select jsonb_agg(jsonb_build_object('account', l.account_code, 'debit', l.credit, 'credit', l.debit,
           'project', l.project_code, 'costCentre', l.cost_centre, 'fund', l.fund_code, 'memo', l.memo)),
         sum(l.credit)
    into v_lines, v_total
  from public.journal_lines l where l.journal_id = je.id;
  insert into public.manual_journals(ref, entity_id, kind, entry_date, memo, lines, total, reversal_of, created_by)
  values (public.next_ref('MJ'), je.entity_id, 'reversal', v_date,
          coalesce(nullif(trim(coalesce(p_reason,'')), ''), 'Reversal of ' || p_je_ref), v_lines, round(v_total, 2), p_je_ref,
          (select id from public.app_users where auth_id = auth.uid()))
  returning id into v_id;
  perform public.audit_write('manual_journal.reversal_started', 'journal_entry', p_je_ref, jsonb_build_object('reason', p_reason));
  return public.mj_json(v_id);
end $$;

-- ---------- reconciliation (bank / M-Pesa / petty cash) ----------
create table if not exists public.gl_statement_lines (
  id           uuid primary key default gen_random_uuid(),
  account_code text not null,
  period       text not null,
  line_date    date not null,
  description  text,
  reference    text,
  amount       numeric(16,2) not null,          -- + money in, − money out
  matched_line uuid references public.journal_lines(id) on delete set null,
  created_by   uuid references public.app_users(id),
  created_at   timestamptz not null default now()
);
create index if not exists gl_statement_lines_acct_idx on public.gl_statement_lines(account_code, period);

create table if not exists public.gl_reconciliations (
  id                uuid primary key default gen_random_uuid(),
  account_code      text not null,
  period            text not null,
  statement_balance numeric(16,2) not null,
  ledger_balance    numeric(16,2) not null,
  difference        numeric(16,2) not null,
  state             text not null check (state in ('reconciled','difference')),
  notes             text,
  prepared_by       uuid references public.app_users(id),
  prepared_at       timestamptz not null default now(),
  unique (account_code, period)
);

create or replace function public.gl_period_end(p_period text) returns date
language sql immutable as $$ select (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date $$;

create or replace function public.gl_balance_at(p_code text, p_to date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.debit - l.credit), 0)
  from public.journal_lines l join public.journal_entries e on e.id = l.journal_id
  where l.account_code = p_code and e.entry_date <= p_to
$$;

create or replace function public.gl_add_statement_lines(p_account text, p_period text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l jsonb; n int := 0;
begin
  perform public.assert_access('finance', 2);
  if not exists (select 1 from public.chart_of_accounts where code = p_account and reconcilable) then
    raise exception 'Account % is not a reconcilable bank / cash account', p_account;
  end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'Period must be YYYY-MM'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    if nullif(l->>'date','') is null or nullif(l->>'amount','') is null then continue; end if;
    insert into public.gl_statement_lines(account_code, period, line_date, description, reference, amount, created_by)
    values (p_account, p_period, (l->>'date')::date, nullif(trim(coalesce(l->>'description','')),''),
            nullif(trim(coalesce(l->>'reference','')),''), (l->>'amount')::numeric,
            (select id from public.app_users where auth_id = auth.uid()));
    n := n + 1;
  end loop;
  perform public.audit_write('reconciliation.statement_added', 'gl_account', p_account, jsonb_build_object('period', p_period, 'lines', n));
  return jsonb_build_object('added', n);
end $$;

create or replace function public.gl_delete_statement_line(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record;
begin
  perform public.assert_access('finance', 2);
  select * into s from public.gl_statement_lines where id = p_id;
  if not found then raise exception 'Statement line not found'; end if;
  if public.gl_period_state(s.period) <> 'open' then raise exception 'The % period has moved past reconciliation', s.period; end if;
  delete from public.gl_statement_lines where id = p_id;
  return jsonb_build_object('deleted', p_id);
end $$;

-- match (or unmatch with p_line null) a statement line to a ledger line on the same account
create or replace function public.gl_match_statement_line(p_id uuid, p_line uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record;
begin
  perform public.assert_access('finance', 2);
  select * into s from public.gl_statement_lines where id = p_id;
  if not found then raise exception 'Statement line not found'; end if;
  if p_line is not null then
    if not exists (select 1 from public.journal_lines where id = p_line and account_code = s.account_code) then
      raise exception 'That ledger line is not on account %', s.account_code;
    end if;
    if exists (select 1 from public.gl_statement_lines where matched_line = p_line and id <> p_id) then
      raise exception 'That ledger line is already matched';
    end if;
  end if;
  update public.gl_statement_lines set matched_line = p_line where id = p_id;
  return jsonb_build_object('id', p_id, 'matched', p_line);
end $$;

-- auto-match: same amount, within 5 days, one-to-one
create or replace function public.gl_auto_match(p_account text, p_period text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; v_line uuid; n int := 0;
begin
  perform public.assert_access('finance', 2);
  for s in select * from public.gl_statement_lines
            where account_code = p_account and period = p_period and matched_line is null order by line_date loop
    select l.id into v_line
    from public.journal_lines l join public.journal_entries e on e.id = l.journal_id
    where l.account_code = p_account and (l.debit - l.credit) = s.amount
      and abs(e.entry_date - s.line_date) <= 5
      and not exists (select 1 from public.gl_statement_lines x where x.matched_line = l.id)
    order by abs(e.entry_date - s.line_date) limit 1;
    if v_line is not null then
      update public.gl_statement_lines set matched_line = v_line where id = s.id; n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('matched', n);
end $$;

create or replace function public.gl_save_reconciliation(p_account text, p_period text, p_statement_balance numeric, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ledger numeric; v_diff numeric; v_state text;
begin
  perform public.assert_access('finance', 2);
  if not exists (select 1 from public.chart_of_accounts where code = p_account and reconcilable) then
    raise exception 'Account % is not reconcilable', p_account;
  end if;
  if p_statement_balance is null then raise exception 'Enter the closing balance on the statement'; end if;
  if public.gl_period_state(p_period) not in ('open','reconciled') then raise exception 'The % period is past reconciliation', p_period; end if;
  v_ledger := public.gl_balance_at(p_account, public.gl_period_end(p_period));
  v_diff := round(p_statement_balance - v_ledger, 2);
  v_state := case when abs(v_diff) < 0.005 then 'reconciled' else 'difference' end;
  if v_state = 'difference' and nullif(trim(coalesce(p_notes,'')), '') is null then
    raise exception 'The statement differs from the ledger by KES % — post the missing entries, or note why', to_char(v_diff, 'FM999,999,990.00');
  end if;
  insert into public.gl_reconciliations(account_code, period, statement_balance, ledger_balance, difference, state, notes, prepared_by, prepared_at)
  values (p_account, p_period, p_statement_balance, v_ledger, v_diff, v_state, nullif(trim(coalesce(p_notes,'')), ''),
          (select id from public.app_users where auth_id = auth.uid()), now())
  on conflict (account_code, period) do update set
    statement_balance = excluded.statement_balance, ledger_balance = excluded.ledger_balance,
    difference = excluded.difference, state = excluded.state, notes = excluded.notes,
    prepared_by = excluded.prepared_by, prepared_at = now();
  perform public.audit_write('reconciliation.saved', 'gl_account', p_account,
    jsonb_build_object('period', p_period, 'statement', p_statement_balance, 'ledger', v_ledger, 'difference', v_diff));
  return jsonb_build_object('account', p_account, 'period', p_period, 'ledger', v_ledger, 'statement', p_statement_balance,
                            'difference', v_diff, 'state', v_state);
end $$;

-- ---------- reports ----------
-- trial balance for a range of periods: opening, movement, closing per account
create or replace function public.gl_trial_balance(p_from text, p_to text)
returns jsonb language sql stable security definer set search_path = public as $$
  with b as (
    select a.code, a.name, a.kind,
      coalesce(sum(l.debit - l.credit) filter (where e.period < p_from), 0) as opening,
      coalesce(sum(l.debit)  filter (where e.period between p_from and p_to), 0) as dr,
      coalesce(sum(l.credit) filter (where e.period between p_from and p_to), 0) as cr,
      coalesce(sum(l.debit - l.credit) filter (where e.period <= p_to), 0) as closing
    from public.chart_of_accounts a
    left join public.journal_lines l on l.account_code = a.code
    left join public.journal_entries e on e.id = l.journal_id
    where a.entity_id = (select id from public.entities where code = 'KE')
    group by a.code, a.name, a.kind
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'rows', coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'kind', kind,
              'opening', opening, 'debit', dr, 'credit', cr, 'closing', closing) order by code)
              filter (where opening <> 0 or dr <> 0 or cr <> 0), '[]'::jsonb),
    'totalDebit', coalesce(sum(dr), 0), 'totalCredit', coalesce(sum(cr), 0),
    'closingDebit', coalesce(sum(closing) filter (where closing > 0), 0),
    'closingCredit', coalesce(-sum(closing) filter (where closing < 0), 0))
  from b
$$;

-- P&L for a range of periods, optionally for one project / fund
create or replace function public.gl_income_statement(p_from text, p_to text, p_project text default null, p_fund text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with m as (
    select a.code, a.name, a.kind,
      sum(case when a.kind = 'income' then l.credit - l.debit else l.debit - l.credit end) as amt
    from public.journal_lines l
    join public.journal_entries e on e.id = l.journal_id
    join public.chart_of_accounts a on a.code = l.account_code and a.entity_id = e.entity_id
    where a.kind in ('income','expense') and e.period between p_from and p_to
      and (p_project is null or l.project_code = p_project)
      and (p_fund is null or l.fund_code = p_fund)
    group by a.code, a.name, a.kind
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'project', p_project, 'fund', p_fund,
    'income',  coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', amt) order by code) filter (where kind = 'income'), '[]'::jsonb),
    'expense', coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', amt) order by code) filter (where kind = 'expense'), '[]'::jsonb),
    'totalIncome',  coalesce(sum(amt) filter (where kind = 'income'), 0),
    'totalExpense', coalesce(sum(amt) filter (where kind = 'expense'), 0),
    'net', coalesce(sum(amt) filter (where kind = 'income'), 0) - coalesce(sum(amt) filter (where kind = 'expense'), 0))
  from m
$$;

-- balance sheet at the end of a period; unclosed P&L shows as current earnings
create or replace function public.gl_balance_sheet(p_to text)
returns jsonb language sql stable security definer set search_path = public as $$
  with b as (
    select a.code, a.name, a.kind, coalesce(sum(l.debit - l.credit), 0) as bal
    from public.chart_of_accounts a
    left join public.journal_lines l on l.account_code = a.code
    left join public.journal_entries e on e.id = l.journal_id and e.period <= p_to
    where a.entity_id = (select id from public.entities where code = 'KE') and (l.id is null or e.id is not null)
    group by a.code, a.name, a.kind
  )
  select jsonb_build_object(
    'to', p_to,
    'assets',      coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', bal) order by code) filter (where kind = 'asset' and bal <> 0), '[]'::jsonb),
    'liabilities', coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', -bal) order by code) filter (where kind = 'liability' and bal <> 0), '[]'::jsonb),
    'equity',      coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', -bal) order by code) filter (where kind = 'equity' and bal <> 0), '[]'::jsonb),
    'currentEarnings', coalesce(-sum(bal) filter (where kind in ('income','expense')), 0),
    'totalAssets', coalesce(sum(bal) filter (where kind = 'asset'), 0),
    'totalLiabilities', coalesce(-sum(bal) filter (where kind = 'liability'), 0),
    'totalEquity', coalesce(-sum(bal) filter (where kind in ('equity','income','expense')), 0))
  from b
$$;

-- one account's lines with running balance
create or replace function public.gl_account_ledger(p_code text, p_from text, p_to text)
returns jsonb language sql stable security definer set search_path = public as $$
  with o as (
    select coalesce(sum(l.debit - l.credit), 0) as opening
    from public.journal_lines l join public.journal_entries e on e.id = l.journal_id
    where l.account_code = p_code and e.period < p_from
  ), x as (
    select e.ref, e.entry_date, e.memo, e.source_type, e.source_ref, e.kind, e.state,
           l.id, l.debit, l.credit, l.project_code, l.cost_centre, l.fund_code, l.memo as line_memo, e.created_at,
           sum(l.debit - l.credit) over (order by e.entry_date, e.created_at, l.id) as run
    from public.journal_lines l join public.journal_entries e on e.id = l.journal_id
    where l.account_code = p_code and e.period between p_from and p_to
  )
  select jsonb_build_object(
    'code', p_code, 'name', (select name from public.chart_of_accounts where code = p_code limit 1),
    'kind', (select kind from public.chart_of_accounts where code = p_code limit 1),
    'opening', (select opening from o),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'ref', ref, 'date', entry_date, 'memo', coalesce(line_memo, memo), 'source', source_type, 'sourceRef', source_ref,
        'kind', kind, 'state', state, 'debit', debit, 'credit', credit, 'project', project_code, 'costCentre', cost_centre, 'fund', fund_code,
        'balance', (select opening from o) + run)
      order by entry_date, created_at, id) from x), '[]'::jsonb))
$$;

-- project actuals straight from the ledger (spec §9 "the join")
create or replace function public.gl_project_actuals(p_from text, p_to text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(r order by r->>'project'), '[]'::jsonb) from (
    select jsonb_build_object(
      'project', coalesce(l.project_code, '(' || coalesce(l.cost_centre, 'unallocated') || ')'),
      'isProject', l.project_code is not null,
      'fund', max(l.fund_code),
      'expense', coalesce(sum(l.debit - l.credit) filter (where a.kind = 'expense'), 0),
      'income',  coalesce(sum(l.credit - l.debit) filter (where a.kind = 'income'), 0),
      'budget', (select p.budget_amount from public.projects p where p.name = l.project_code limit 1)) as r
    from public.journal_lines l
    join public.journal_entries e on e.id = l.journal_id
    join public.chart_of_accounts a on a.code = l.account_code and a.entity_id = e.entity_id
    where a.kind in ('income','expense') and e.period between p_from and p_to
    group by coalesce(l.project_code, '(' || coalesce(l.cost_centre, 'unallocated') || ')'), l.project_code is not null, l.project_code
  ) t
$$;

-- ---------- period workflow (spec §10) ----------
create or replace function public.gl_period_checks(p_period text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'period', p_period,
    'state', public.gl_period_state(p_period),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object(
        'code', a.code, 'name', a.name,
        'ledger', public.gl_balance_at(a.code, public.gl_period_end(p_period)),
        'active', exists (select 1 from public.journal_lines l join public.journal_entries e on e.id = l.journal_id
                           where l.account_code = a.code and e.period <= p_period),
        'rec', (select jsonb_build_object('state', r.state, 'statement', r.statement_balance, 'difference', r.difference, 'notes', r.notes)
                  from public.gl_reconciliations r where r.account_code = a.code and r.period = p_period)) order by a.code)
      from public.chart_of_accounts a where a.reconcilable and a.active), '[]'::jsonb),
    'tb', public.gl_trial_balance(p_period, p_period) - 'rows',
    'pendingJournals', (select count(*) from public.manual_journals m
                          where m.state = 'submitted' and to_char(m.entry_date, 'YYYY-MM') = p_period),
    'earlierOpen', (select coalesce(jsonb_agg(p.period order by p.period), '[]'::jsonb) from public.gl_periods p
                     where p.period < p_period and p.state not in ('closed','reported')))
$$;

create or replace function public.gl_advance_period(p_period text, p_to text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_state text; c jsonb; a jsonb; v_me uuid := (select id from public.app_users where auth_id = auth.uid());
        v_entity uuid := (select id from public.entities where code = 'KE');
        v_order text[] := array['open','reconciled','tb_agreed','closed','reported'];
begin
  perform public.assert_access('finance', 3);
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'Period must be YYYY-MM'; end if;
  if to_date(p_period || '-01','YYYY-MM-DD') > date_trunc('month', public.ke_today()) then
    raise exception 'The % period has not started yet', p_period;
  end if;
  insert into public.gl_periods(entity_id, period) values (v_entity, p_period) on conflict (entity_id, period) do nothing;
  v_state := public.gl_period_state(p_period);
  if array_position(v_order, p_to) is distinct from array_position(v_order, v_state) + 1 then
    raise exception 'The % period is %; it moves one step at a time (Open → Reconciled → TB agreed → Closed → Reported)', p_period, replace(v_state, '_', ' ');
  end if;
  c := public.gl_period_checks(p_period);
  if p_to = 'reconciled' then
    for a in select * from jsonb_array_elements(c->'accounts') loop
      if (a->>'active')::boolean and coalesce(a->'rec'->>'state', '') <> 'reconciled' then
        raise exception '% % is not reconciled for % — reconcile it against the statement first', a->>'code', a->>'name', p_period;
      end if;
    end loop;
    update public.gl_periods set state = 'reconciled', reconciled_by = v_me, reconciled_at = now() where entity_id = v_entity and period = p_period;
  elsif p_to = 'tb_agreed' then
    if (c->'tb'->>'totalDebit')::numeric <> (c->'tb'->>'totalCredit')::numeric then
      raise exception 'The trial balance does not agree (debits % vs credits %)', c->'tb'->>'totalDebit', c->'tb'->>'totalCredit';
    end if;
    update public.gl_periods set state = 'tb_agreed', tb_agreed_by = v_me, tb_agreed_at = now() where entity_id = v_entity and period = p_period;
  elsif p_to = 'closed' then
    if jsonb_array_length(c->'earlierOpen') > 0 then
      raise exception 'Close the earlier period(s) first: %', (select string_agg(x, ', ') from jsonb_array_elements_text(c->'earlierOpen') x);
    end if;
    if (c->>'pendingJournals')::int > 0 then
      raise exception '% journal(s) dated in % are still awaiting approval — approve or reject them first', c->>'pendingJournals', p_period;
    end if;
    update public.gl_periods set state = 'closed', closed_by = v_me, closed_at = now() where entity_id = v_entity and period = p_period;
  elsif p_to = 'reported' then
    update public.gl_periods set state = 'reported', reported_by = v_me, reported_at = now() where entity_id = v_entity and period = p_period;
  end if;
  perform public.audit_write('period.' || p_to, 'gl_period', p_period, jsonb_build_object('from', v_state));
  return public.gl_period_checks(p_period);
end $$;

-- ---------- chart of accounts / funds / mappings maintenance ----------
create or replace function public.gl_save_account(p_code text, p_name text, p_kind text, p_reconcilable boolean default false,
                                                  p_manual_allowed boolean default true, p_active boolean default true, p_description text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entity uuid := (select id from public.entities where code = 'KE'); ex record; v_bal numeric;
begin
  perform public.assert_access('finance', 3);
  if coalesce(p_code,'') !~ '^\d{4}$' then raise exception 'Account codes are 4 digits'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Name the account'; end if;
  if p_kind not in ('asset','liability','equity','income','expense') then raise exception 'Pick the account type'; end if;
  select * into ex from public.chart_of_accounts where entity_id = v_entity and code = p_code;
  if found then
    select coalesce(sum(debit - credit), 0) into v_bal from public.journal_lines where account_code = p_code;
    if ex.kind <> p_kind and exists (select 1 from public.journal_lines where account_code = p_code) then
      raise exception 'Account % already has postings — its type cannot change', p_code;
    end if;
    if not p_active and v_bal <> 0 then raise exception 'Account % has a balance — it cannot be deactivated', p_code; end if;
    if not p_active and exists (select 1 from public.gl_mappings where account_code = p_code) then
      raise exception 'Account % is used in the account mappings — re-map it first', p_code;
    end if;
    update public.chart_of_accounts set name = trim(p_name), kind = p_kind, reconcilable = p_reconcilable,
           manual_allowed = p_manual_allowed, active = p_active, description = nullif(trim(coalesce(p_description,'')),'')
     where id = ex.id;
  else
    insert into public.chart_of_accounts(entity_id, code, name, kind, reconcilable, manual_allowed, active, description)
    values (v_entity, p_code, trim(p_name), p_kind, p_reconcilable, p_manual_allowed, p_active, nullif(trim(coalesce(p_description,'')),''));
  end if;
  perform public.audit_write('gl.account_saved', 'gl_account', p_code, jsonb_build_object('name', p_name, 'kind', p_kind, 'active', p_active));
  return jsonb_build_object('code', p_code);
end $$;

create or replace function public.gl_set_mapping(p_event text, p_role text, p_account text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare old_code text;
begin
  perform public.assert_access('finance', 3);
  select account_code into old_code from public.gl_mappings where event = p_event and role = p_role;
  if not found then raise exception 'Unknown mapping %/%', p_event, p_role; end if;
  if not exists (select 1 from public.chart_of_accounts where code = p_account and active) then
    raise exception 'Account % is not an active account', p_account;
  end if;
  update public.gl_mappings set account_code = p_account, updated_at = now() where event = p_event and role = p_role;
  perform public.audit_write('gl.mapping_changed', 'gl_mapping', p_event || '/' || p_role, jsonb_build_object('from', old_code, 'to', p_account));
  return jsonb_build_object('event', p_event, 'role', p_role, 'account', p_account);
end $$;

create or replace function public.gl_save_fund(p_code text, p_name text, p_donor text default null, p_restricted boolean default true, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_access('finance', 3);
  if coalesce(p_code,'') !~ '^[A-Z0-9_]{2,12}$' then raise exception 'Fund codes are 2–12 capital letters or digits'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Name the fund'; end if;
  insert into public.gl_funds(code, name, donor, restricted, active) values (p_code, trim(p_name), nullif(trim(coalesce(p_donor,'')),''), p_restricted, p_active)
  on conflict (code) do update set name = excluded.name, donor = excluded.donor, restricted = excluded.restricted, active = excluded.active;
  perform public.audit_write('gl.fund_saved', 'gl_fund', p_code, jsonb_build_object('name', p_name, 'restricted', p_restricted));
  return jsonb_build_object('code', p_code);
end $$;

create or replace function public.gl_set_project_fund(p_project text, p_fund text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_access('finance', 3);
  if p_fund is not null and not exists (select 1 from public.gl_funds where code = p_fund) then raise exception 'Unknown fund %', p_fund; end if;
  update public.projects set fund_code = p_fund where name = p_project;
  if not found then raise exception 'Project % not found', p_project; end if;
  perform public.audit_write('gl.project_fund', 'project', p_project, jsonb_build_object('fund', p_fund));
  return jsonb_build_object('project', p_project, 'fund', p_fund);
end $$;

-- ---------- RLS (read for signed-in users; writes only through the RPCs) ----------
do $$
declare t text;
begin
  foreach t in array array['gl_funds','gl_mappings','gl_periods','manual_journals','gl_statement_lines','gl_reconciliations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'save_manual_journal(uuid, jsonb)', 'submit_manual_journal(uuid)', 'approve_manual_journal(uuid)',
    'reject_manual_journal(uuid, text)', 'delete_manual_journal(uuid)', 'start_journal_reversal(text, date, text)',
    'gl_add_statement_lines(text, text, jsonb)', 'gl_delete_statement_line(uuid)', 'gl_match_statement_line(uuid, uuid)',
    'gl_auto_match(text, text)', 'gl_save_reconciliation(text, text, numeric, text)',
    'gl_trial_balance(text, text)', 'gl_income_statement(text, text, text, text)', 'gl_balance_sheet(text)',
    'gl_account_ledger(text, text, text)', 'gl_project_actuals(text, text)', 'gl_period_checks(text)',
    'gl_advance_period(text, text)', 'gl_save_account(text, text, text, boolean, boolean, boolean, text)',
    'gl_set_mapping(text, text, text)', 'gl_save_fund(text, text, text, boolean, boolean)',
    'gl_set_project_fund(text, text)', 'gl_my_authority()', 'set_app_config(text, jsonb)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  foreach fn in array array['mj_json(uuid)', 'mj_check_lines(text, jsonb, boolean)', 'gl_balance_at(text, date)', 'gl_period_state(text)'] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
  end loop;
end $$;
