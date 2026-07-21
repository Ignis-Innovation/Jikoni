-- ============================================================
-- Jikoni Master PRD — Phase 2b: delivery receipts on dispatches
-- Once a dispatch is marked "delivered" the field team attaches a proof-of-
-- delivery receipt (photo / signed note / PDF). The file lives in Supabase
-- Storage; the dispatch row just keeps the object path.
--   * dispatches.receipt_path   — storage path of the uploaded receipt
--   * attach_dispatch_receipt() — records the path (inventory edit access)
--   * storage bucket 'dispatch-receipts' (public read, authenticated write)
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- column ----------
alter table public.dispatches add column if not exists receipt_path text;

-- ---------- storage bucket + policies (wrapped so a locked-down role can't abort the migration) ----------
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('dispatch-receipts', 'dispatch-receipts', true)
  on conflict (id) do nothing;

  drop policy if exists "dispatch receipts read"   on storage.objects;
  drop policy if exists "dispatch receipts insert" on storage.objects;
  drop policy if exists "dispatch receipts update" on storage.objects;

  create policy "dispatch receipts read" on storage.objects
    for select to public using (bucket_id = 'dispatch-receipts');
  create policy "dispatch receipts insert" on storage.objects
    for insert to authenticated with check (bucket_id = 'dispatch-receipts');
  create policy "dispatch receipts update" on storage.objects
    for update to authenticated using (bucket_id = 'dispatch-receipts');
exception when others then
  raise notice 'storage bucket/policy setup skipped: %', sqlerrm;
end $$;

-- ---------- attach a receipt to a dispatch ----------
create or replace function public.attach_dispatch_receipt(p_ref text, p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record;
begin
  perform public.assert_access('inventory', 2);
  if nullif(trim(coalesce(p_path, '')), '') is null then
    raise exception 'A receipt file is required';
  end if;
  select * into d from public.dispatches where ref = p_ref;
  if not found then raise exception 'Unknown dispatch: %', p_ref; end if;
  update public.dispatches set receipt_path = p_path, updated_at = now() where ref = p_ref;
  perform public.audit_write('dispatch.receipt_attached', 'dispatch', p_ref,
    jsonb_build_object('path', p_path));
  return jsonb_build_object('id', p_ref, 'receipt', p_path);
end $$;

-- ---------- grant: authenticated only, never public/anon ----------
do $$
begin
  revoke execute on function public.attach_dispatch_receipt(text, text) from public, anon;
  grant  execute on function public.attach_dispatch_receipt(text, text) to authenticated;
end $$;
