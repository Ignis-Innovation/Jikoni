-- ============================================================
-- Jikoni Master PRD — Phase 2c: delete a staff self-service document
-- Staff can remove a document they uploaded to their own personal file
-- (from the Staff Portal). Removes the metadata entry from staff_files.docs
-- and, if the doc was a leave attachment, clears leave_applications.doc_path.
-- The underlying object is deleted from the private 'staff-documents' bucket
-- by the client (owner-scoped storage delete policy added below).
--   * delete_staff_document() — remove a doc from the caller's own file by path
--   * "staff docs delete"     — owner may delete objects under their own prefix
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- storage delete policy: owner may delete their own objects ----------
do $$
begin
  drop policy if exists "staff docs delete" on storage.objects;
  create policy "staff docs delete" on storage.objects
    for delete to authenticated using (
      bucket_id = 'staff-documents'
      and split_part(name, '/', 1) = (select id::text from public.app_users where auth_id = auth.uid()));
exception when others then
  raise notice 'staff-documents delete policy setup skipped: %', sqlerrm;
end $$;

-- ---------- remove a document from the caller's own staff file ----------
create or replace function public.delete_staff_document(p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entry jsonb;
begin
  if v_me is null then raise exception 'No staff record for this login'; end if;
  if nullif(trim(coalesce(p_path, '')), '') is null then raise exception 'A document path is required'; end if;

  -- locate the entry so we can audit it and honour any leave link
  select d into v_entry
  from public.staff_files sf, jsonb_array_elements(sf.docs) d
  where sf.app_user_id = v_me and d->>'path' = p_path
  limit 1;
  if v_entry is null then raise exception 'That document is not on your file'; end if;

  -- drop the matching entry from the docs array
  update public.staff_files
    set docs = coalesce((
        select jsonb_agg(d)
        from jsonb_array_elements(docs) d
        where d->>'path' <> p_path), '[]'::jsonb),
        updated_at = now()
  where app_user_id = v_me;

  -- if it was a leave attachment, unstamp the request
  if v_entry->>'leaveRef' is not null then
    update public.leave_applications set doc_path = null, updated_at = now()
    where ref = v_entry->>'leaveRef' and app_user_id = v_me and doc_path = p_path;
  end if;

  perform public.audit_write('staff.document_deleted', 'staff_file', v_me::text,
    jsonb_build_object('name', v_entry->>'name', 'version', v_entry->>'version',
      'category', v_entry->>'category', 'leaveRef', v_entry->>'leaveRef'));
  return v_entry;
end $$;

-- ---------- grant: authenticated only, never public/anon ----------
do $$
begin
  revoke execute on function public.delete_staff_document(text) from public, anon;
  grant  execute on function public.delete_staff_document(text) to authenticated;
end $$;
