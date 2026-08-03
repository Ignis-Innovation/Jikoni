-- Make the Settings page fully interactive: every control now persists to app_config.
-- Expand the set_app_config allowlist with the org / notification / approval / security /
-- integration keys the Settings UI writes, and seed sensible defaults. Idempotent.

create or replace function public.set_app_config(p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_access('users', 2);
  if p_key not in (
    -- existing control-plane keys
    'match_tolerance_pct','po_amend_tolerance_pct','manual_journal_threshold',
    'reminder_hours','escalation_hours','enforce_sod','enforce_access',
    -- organisation profile
    'org_legal_name','primary_entity','base_currency','fiscal_year_start',
    -- notification preferences
    'notif_in_app','notif_email_digest','notif_sms_overdue','notif_stalled_eng',
    -- approval thresholds
    'approve_auto_below','single_approver_max','dual_approval_max','md_signoff_above',
    -- security & data
    'require_2fa','dataroom_mode',
    -- integrations (connected on/off)
    'integ_mpesa','integ_etims','integ_email','integ_sms','integ_claude','integ_ura'
  ) then
    raise exception 'Unknown setting: %', p_key;
  end if;
  insert into public.app_config(key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit_write('config.updated','app_config', p_key, jsonb_build_object('value', p_value));
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

-- seed defaults (only if absent, so we never stomp an admin's saved value)
insert into public.app_config(key, value) values
  ('org_legal_name',     '"Ignis Innovation Limited"'::jsonb),
  ('primary_entity',     '"Kenya"'::jsonb),
  ('base_currency',      '"KES"'::jsonb),
  ('fiscal_year_start',  '"January"'::jsonb),
  ('notif_in_app',       'true'::jsonb),
  ('notif_email_digest', 'true'::jsonb),
  ('notif_sms_overdue',  'false'::jsonb),
  ('notif_stalled_eng',  'true'::jsonb),
  ('approve_auto_below', '5000'::jsonb),
  ('single_approver_max','100000'::jsonb),
  ('dual_approval_max',  '500000'::jsonb),
  ('md_signoff_above',   '500000'::jsonb),
  ('require_2fa',        'true'::jsonb),
  ('dataroom_mode',      'false'::jsonb),
  ('integ_mpesa',        'true'::jsonb),
  ('integ_etims',        'true'::jsonb),
  ('integ_email',        'true'::jsonb),
  ('integ_sms',          'true'::jsonb),
  ('integ_claude',       'true'::jsonb),
  ('integ_ura',          'false'::jsonb)
on conflict (key) do nothing;
