-- ============================================================
-- Jikoni Master PRD — Phase 2c: staff self-service documents
-- Staff upload documents to their own personal file (from the Staff Portal),
-- and can attach a supporting document (e.g. a sick note) when they apply for
-- leave. Files live in a PRIVATE Supabase Storage bucket; the metadata is
-- appended to staff_files.docs so HR sees it on the staff file, and a leave
-- attachment also stamps leave_applications.doc_path so it shows in the queue.
--   * bucket 'staff-documents'  — private; owner + HR read, owner writes own prefix
--   * leave_applications.doc_path — optional attachment on a leave request
--   * add_staff_document()      — append a doc to the caller's own file
-- Path convention: <app_user_id>/<category>/<timestamp>-<filename>
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- attachment column on a leave request ----------
alter table public.leave_applications add column if not exists doc_path text;

-- ---------- private storage bucket + policies ----------
-- (wrapped so a locked-down role can't abort the migration)
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('staff-documents', 'staff-documents', false)
  on conflict (id) do nothing;

  drop policy if exists "staff docs read"   on storage.objects;
  drop policy if exists "staff docs insert" on storage.objects;
  drop policy if exists "staff docs update" on storage.objects;

  -- Read: the owner (their own <app_user_id>/ prefix) or anyone with HR access.
  create policy "staff docs read" on storage.objects
    for select to authenticated using (
      bucket_id = 'staff-documents' and (
        split_part(name, '/', 1) = (select id::text from public.app_users where auth_id = auth.uid())
        or exists (
          select 1 from public.user_permissions up
          join public.app_users u on u.email = up.email
          where u.auth_id = auth.uid() and up.module = 'hr' and up.level >= 1)
      ));
  -- Write: only into your own <app_user_id>/ prefix.
  create policy "staff docs insert" on storage.objects
    for insert to authenticated with check (
      bucket_id = 'staff-documents'
      and split_part(name, '/', 1) = (select id::text from public.app_users where auth_id = auth.uid()));
  create policy "staff docs update" on storage.objects
    for update to authenticated using (
      bucket_id = 'staff-documents'
      and split_part(name, '/', 1) = (select id::text from public.app_users where auth_id = auth.uid()));
exception when others then
  raise notice 'staff-documents bucket/policy setup skipped: %', sqlerrm;
end $$;

-- ---------- append a document to the caller's own staff file ----------
create or replace function public.add_staff_document(
  p_name text, p_path text, p_category text default 'other', p_leave_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_ver int;
  v_entry jsonb;
begin
  if v_me is null then raise exception 'No staff record for this login'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'A document name is required'; end if;
  if nullif(trim(coalesce(p_path, '')), '') is null then raise exception 'A file is required'; end if;
  if not exists (select 1 from public.staff_files where app_user_id = v_me) then
    raise exception 'No staff file for this login';
  end if;

  -- next version for a document of the same name
  v_ver := coalesce((
    select max((d->>'version')::int)
    from public.staff_files sf, jsonb_array_elements(sf.docs) d
    where sf.app_user_id = v_me and d->>'name' = p_name), 0) + 1;

  v_entry := jsonb_build_object(
    'name', p_name, 'version', v_ver, 'uploaded', to_char(now(), 'YYYY-MM-DD'),
    'path', p_path, 'category', coalesce(nullif(p_category, ''), 'other'), 'leaveRef', p_leave_ref);

  update public.staff_files set docs = docs || v_entry, updated_at = now() where app_user_id = v_me;

  -- a leave attachment also stamps the request so HR sees it in the approvals queue
  if p_leave_ref is not null then
    update public.leave_applications set doc_path = p_path, updated_at = now()
    where ref = p_leave_ref and app_user_id = v_me;
  end if;

  perform public.audit_write('staff.document_added', 'staff_file', v_me::text,
    jsonb_build_object('name', p_name, 'version', v_ver, 'category', p_category, 'leaveRef', p_leave_ref));
  return v_entry;
end $$;

-- ---------- surface doc_path in the self-service summary ----------
create or replace function public.my_hr_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  if v_me is null then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'leave', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', kind, 'year', year, 'entitled', entitled, 'used', used, 'reserved', reserved))
      from public.leave_balances where app_user_id = v_me), '[]'::jsonb),
    'applications', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ref, 'kind', kind, 'from', from_date, 'to', to_date, 'days', days, 'state', state, 'docPath', doc_path)
        order by created_at desc)
      from public.leave_applications where app_user_id = v_me), '[]'::jsonb),
    'payslips', coalesce((select jsonb_agg(jsonb_build_object(
        'period', pr.period, 'gross', i.gross, 'paye', i.paye, 'nssf', i.nssf,
        'shif', i.shif, 'housing', i.housing, 'net', i.net) order by pr.period desc)
      from public.payroll_items i join public.payroll_runs pr on pr.id = i.run_id
      where i.app_user_id = v_me and pr.state = 'posted'), '[]'::jsonb),
    'docs', coalesce((select docs from public.staff_files where app_user_id = v_me), '[]'::jsonb));
end $$;

-- ---------- grant: authenticated only, never public/anon ----------
do $$
begin
  revoke execute on function public.add_staff_document(text, text, text, text) from public, anon;
  grant  execute on function public.add_staff_document(text, text, text, text) to authenticated;
end $$;
