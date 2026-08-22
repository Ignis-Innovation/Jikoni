-- ============================================================
-- 0067 — Petty-cash: attach an invoice/receipt to an approved request
-- Once a request is approved, the requester OR a petty-cash approver (Super Admin
-- users:3 / HR hr>=2 — the Sub Admin holds HR-full) may attach an invoice from the
-- shared 'uploads' bucket. Whoever acts first attaches it; either may remove it and
-- re-attach. The stored value is the object path in the 'uploads' bucket (public).
-- Extends the read shape from 0066 with 'invoicePath'. Idempotent.
-- ============================================================

alter table public.petty_cash_requests add column if not exists invoice_path text;

-- read shape now also carries the attached invoice path (mirrors 0066 + invoicePath)
create or replace function public.pcr_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.ref, 'item', r.item, 'amount', r.amount,
    'needBy', to_char(r.need_by, 'YYYY-MM-DD'), 'reason', r.reason, 'state', r.state,
    'requester', rq.name, 'requesterEmail', rq.email, 'approverRole', r.approver_role,
    'superApprovedBy', su.name, 'superApprovedAt', r.super_approved_at,
    'hrApprovedBy', hr.name, 'hrApprovedAt', r.hr_approved_at,
    'decidedBy', dc.name, 'decidedAt', r.decided_at, 'note', r.decision_note,
    'invoicePath', r.invoice_path,
    'createdAt', r.created_at)
  from public.petty_cash_requests r
  left join public.app_users rq on rq.id = r.requester_id
  left join public.app_users su on su.id = r.super_approved_by
  left join public.app_users hr on hr.id = r.hr_approved_by
  left join public.app_users dc on dc.id = r.decided_by
  where r.ref = p_ref
$$;

-- ---------- attach an invoice (requester or a petty-cash approver) ----------
create or replace function public.attach_petty_cash_invoice(p_ref text, p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  r record;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_path, '')), '') is null then raise exception 'No file was provided'; end if;
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if not (r.requester_id = v_me or public.can_petty_super() or public.can_petty_hr()) then
    raise exception 'Only the requester or a petty-cash approver can attach an invoice';
  end if;
  if r.state <> 'approved' then
    raise exception 'You can only attach an invoice to an approved request';
  end if;
  update public.petty_cash_requests set invoice_path = p_path, updated_at = now() where ref = p_ref;
  perform public.audit_write('petty_cash.invoice_attached', 'petty_cash_request', p_ref,
    jsonb_build_object('path', p_path));
  return public.pcr_json(p_ref);
end $$;

-- ---------- remove the attached invoice (same permission set) ----------
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
  update public.petty_cash_requests set invoice_path = null, updated_at = now() where ref = p_ref;
  perform public.audit_write('petty_cash.invoice_removed', 'petty_cash_request', p_ref, '{}'::jsonb);
  return public.pcr_json(p_ref);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'pcr_json(text)',
    'attach_petty_cash_invoice(text,text)',
    'remove_petty_cash_invoice(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
