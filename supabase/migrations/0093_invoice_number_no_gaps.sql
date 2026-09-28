-- ============================================================
-- 0093 — Invoice numbers can never skip or repeat (client request 2026-09-28)
-- The next IGN-INV-YYYY-NNN is always (highest number already issued that year) + 1,
-- worked out under a row lock so two people issuing at once queue one after the
-- other. The number is taken inside the issue transaction: if issuing fails
-- (e.g. a closed period), everything rolls back and the number is not used.
-- The counter row is kept in step for the "next number" hint on the form.
-- Idempotent.
-- ============================================================
create or replace function public.next_invoice_no(p_date date default public.ke_today()) returns text
language plpgsql security definer set search_path = public as $$
declare v_kind text := 'IGN-INV-' || to_char(p_date, 'YYYY'); v_n int;
begin
  insert into public.ref_counters(kind, prefix, n) values (v_kind, v_kind || '-', 0)
  on conflict (kind) do nothing;
  perform 1 from public.ref_counters where kind = v_kind for update;   -- serialise concurrent issues
  select coalesce(max(substring(ref from '(\d+)$')::int), 0) + 1 into v_n
    from public.sales_invoices where ref like v_kind || '-%';
  update public.ref_counters set n = v_n where kind = v_kind;
  return v_kind || '-' || lpad(v_n::text, 3, '0');
end $$;
revoke execute on function public.next_invoice_no(date) from public, anon, authenticated;
