-- ============================================================
-- Jikoni — Projects & Programmes: real project documents
-- Project docs were plain label strings with no file behind them. This adds a
-- project-docs storage bucket + an add_project_document RPC that appends a
-- {name, path} object to projects.docs, so the drawer can offer real View /
-- Download. The docs column already accepts either legacy strings or objects
-- (the frontend renders both). Idempotent: safe to re-run.
-- ============================================================

-- ---------- storage bucket 'project-docs' (public read, authenticated write) ----------
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('project-docs', 'project-docs', true)
  on conflict (id) do nothing;

  drop policy if exists "project-docs read"   on storage.objects;
  drop policy if exists "project-docs write"  on storage.objects;
  drop policy if exists "project-docs update" on storage.objects;
  create policy "project-docs read"   on storage.objects
    for select to public using (bucket_id = 'project-docs');
  create policy "project-docs write"  on storage.objects
    for insert to authenticated with check (bucket_id = 'project-docs');
  create policy "project-docs update" on storage.objects
    for update to authenticated using (bucket_id = 'project-docs');
end $$;

-- ---------- append a document to a project ----------
create or replace function public.add_project_document(
  p_project_id uuid, p_name text, p_path text
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_access('projects', 2);
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null or nullif(trim(coalesce(p_path, '')), '') is null then
    raise exception 'A document name and path are required';
  end if;
  update public.projects
     set docs = coalesce(docs, '[]'::jsonb) || jsonb_build_object('name', trim(p_name), 'path', p_path),
         updated_at = now()
   where id = p_project_id;
  perform public.audit_write('project.document_added', 'project', p_project_id::text,
    jsonb_build_object('name', p_name, 'path', p_path));
  return public.project_payload(p_project_id);
end $$;

revoke execute on function public.add_project_document(uuid,text,text) from public, anon;
grant execute on function public.add_project_document(uuid,text,text) to authenticated;
