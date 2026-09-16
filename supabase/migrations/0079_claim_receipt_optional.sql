-- ============================================================
-- 0079 — Expense claims: receipts no longer block approval.
-- Reverses the 0078 rule that decide_expense_claim refused to approve a claim with a
-- receiptless expense line. Per Ops: receipts can be attached later (during or after
-- approval), so approval is no longer gated on them. Everything else about decide is
-- unchanged. Idempotent (create or replace).
-- ============================================================

create or replace function public.decide_expense_claim(p_ref text, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_is_super boolean := public.can_petty_super();
  v_is_hr boolean := public.can_petty_hr();
  r record; v_ok boolean;
begin
  if not (v_is_super or v_is_hr) then raise exception 'Only a Super Admin or HR can decide expense claims'; end if;
  select * into r from public.expense_claims where ref = p_ref;
  if not found then raise exception 'Claim not found'; end if;
  if r.state <> 'pending' then raise exception 'This claim was already decided'; end if;
  if r.requester_id = v_me then raise exception 'You cannot decide your own claim'; end if;

  v_ok := case
    when r.approver_role = 'super' then v_is_super
    when r.approver_role = 'hr' then v_is_hr
    else (v_is_super or v_is_hr)
  end;
  if not v_ok then
    raise exception '%', case when r.approver_role = 'super'
      then 'This claim is awaiting Super Admin approval'
      else 'This claim is awaiting HR approval' end;
  end if;

  -- NOTE: receipts no longer block approval (0079) — they can be attached later.

  update public.expense_claims
    set state = case when p_approve then 'approved' else 'rejected' end,
        decided_by = v_me, decided_at = now(),
        decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
    where ref = p_ref;

  if p_approve then perform public.claim_accrue(p_ref); end if;

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  values (v_entity, lower((select email from public.app_users where id = r.requester_id)),
          'expense_claim_decided',
          case when p_approve then 'Expense claim approved' else 'Expense claim rejected' end,
          r.purpose || ' — KES ' || to_char(r.total_amount, 'FM999,999,990') ||
            case when p_note is not null and trim(p_note) <> '' then ' · ' || trim(p_note) else '' end,
          'staffportal', p_ref);
  perform public.audit_write(case when p_approve then 'expense_claim.approved' else 'expense_claim.rejected' end,
    'expense_claim', p_ref, jsonb_build_object('total', r.total_amount, 'note', p_note));

  return public.cej_json(p_ref);
end $$;

revoke execute on function public.decide_expense_claim(text,boolean,text) from public, anon;
grant  execute on function public.decide_expense_claim(text,boolean,text) to authenticated;
