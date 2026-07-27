-- ============================================================
-- Jikoni — Certificate files
-- Certifications could only be recorded by name; you couldn't attach
-- the actual certificate. Now both sides upload the file:
--   * staff, from the Staff Portal "My Certificates" tab
--   * HR, when adding a certification to a staff file
-- The PDF/image lives in the existing private 'staff-documents'
-- bucket under the HOLDER's <app_user_id>/certifications/ prefix, so
-- the employee (own prefix) and HR (module read) can both open it.
-- HR gains write access into any staff prefix so it can upload on a
-- person's behalf. certifications.doc_path stores the object path.
-- Idempotent: safe to re-run.
-- ============================================================

alter table public.certifications add column if not exists doc_path text;

-- ---------- storage: let HR write into any staff prefix ----------
-- (owner-prefix write already exists from 0016; this adds an HR-scoped
--  permissive policy so HR can upload a certificate for someone else)
do $$
begin
  drop policy if exists "staff docs hr insert" on storage.objects;
  drop policy if exists "staff docs hr update" on storage.objects;

  create policy "staff docs hr insert" on storage.objects
    for insert to authenticated with check (
      bucket_id = 'staff-documents' and exists (
        select 1 from public.user_permissions up
        join public.app_users u on u.email = up.email
        where u.auth_id = auth.uid() and up.module = 'hr' and up.level >= 2));
  create policy "staff docs hr update" on storage.objects
    for update to authenticated using (
      bucket_id = 'staff-documents' and exists (
        select 1 from public.user_permissions up
        join public.app_users u on u.email = up.email
        where u.auth_id = auth.uid() and up.module = 'hr' and up.level >= 2));
exception when others then
  raise notice 'staff-documents HR write policy setup skipped: %', sqlerrm;
end $$;

-- ---------- HR adds a certification, optionally with the file ----------
drop function if exists public.add_certification(text, text, text, date, text, boolean);
create or replace function public.add_certification(
  p_holder text, p_name text, p_issuer text default null, p_expiry date default null,
  p_staff_no text default null, p_verified boolean default false, p_doc_path text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_user uuid; v_id uuid;
begin
  perform public.assert_access('hr', 2);
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'A certification needs a name'; end if;
  if nullif(trim(coalesce(p_holder,'')),'') is null then raise exception 'A certification needs a holder'; end if;
  if p_staff_no is not null then
    select app_user_id into v_user from public.staff_files where staff_no = p_staff_no;
  end if;
  insert into public.certifications(entity_id, app_user_id, holder, name, issuer, expiry, state, doc_path)
  values (v_entity, v_user, trim(p_holder), trim(p_name), nullif(trim(coalesce(p_issuer,'')),''), p_expiry,
          case when p_verified then 'verified' else 'pending' end, nullif(trim(coalesce(p_doc_path,'')),''))
  returning id into v_id;
  perform public.audit_write('hr.certification_added','staff', coalesce(p_staff_no, trim(p_holder)),
    jsonb_build_object('name', p_name, 'issuer', p_issuer, 'state', case when p_verified then 'verified' else 'pending' end, 'file', p_doc_path is not null));
  return jsonb_build_object('id', v_id, 'holder', p_holder, 'name', p_name);
end $$;

-- ---------- staff submit their own certification, optionally with the file ----------
drop function if exists public.submit_my_certification(text, text, date);
create or replace function public.submit_my_certification(
  p_name text, p_issuer text default null, p_expiry date default null, p_doc_path text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_name text; v_id uuid;
begin
  if v_me is null then raise exception 'No staff record is linked to this login'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'A certification needs a name'; end if;
  select name into v_name from public.app_users where id = v_me;
  insert into public.certifications(entity_id, app_user_id, holder, name, issuer, expiry, state, doc_path)
  values (v_entity, v_me, v_name, trim(p_name), nullif(trim(coalesce(p_issuer,'')),''), p_expiry, 'pending',
          nullif(trim(coalesce(p_doc_path,'')),''))
  returning id into v_id;
  perform public.audit_write('hr.certification_submitted','staff', v_name,
    jsonb_build_object('name', p_name, 'issuer', p_issuer, 'file', p_doc_path is not null));
  return jsonb_build_object('id', v_id, 'name', p_name, 'state', 'pending');
end $$;

-- ---------- grants for the new signatures ----------
do $$ begin
  revoke execute on function public.add_certification(text, text, text, date, text, boolean, text) from public, anon;
  grant  execute on function public.add_certification(text, text, text, date, text, boolean, text) to authenticated;
  revoke execute on function public.submit_my_certification(text, text, date, text) from public, anon;
  grant  execute on function public.submit_my_certification(text, text, date, text) to authenticated;
end $$;
