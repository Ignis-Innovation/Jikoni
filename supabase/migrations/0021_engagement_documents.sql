-- ============================================================
-- Jikoni — Partnerships CRM: engagement documents
-- Documents are only attached when someone actually uploads one — either while
-- creating an engagement or when logging an update. The file lives in Supabase
-- Storage; a metadata row keeps the object path so anyone with CRM access can
-- open / download it from the engagement drawer.
--   * engagement_documents        — name + storage path per engagement (+ note)
--   * add_engagement_document()    — records an uploaded file (crm edit access)
--   * storage bucket 'engagement-docs' (public read, authenticated write)
-- Bootstrap is left untouched — the client folds docs in by ref (same approach
-- as dispatch receipts), so no re-declaration of the big bootstrap() function.
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- table ----------
create table if not exists public.engagement_documents (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  note_id       uuid references public.engagement_notes(id) on delete set null,
  name          text not null,
  path          text not null,
  who           text,
  created_at    timestamptz not null default now()
);
create index if not exists engagement_documents_eng_idx on public.engagement_documents(engagement_id, created_at desc);

-- read for signed-in users; writes only via the definer RPC
alter table public.engagement_documents enable row level security;
drop policy if exists "read for authenticated" on public.engagement_documents;
create policy "read for authenticated" on public.engagement_documents for select to authenticated using (true);

-- ---------- storage bucket + policies (wrapped so a locked-down role can't abort the migration) ----------
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('engagement-docs', 'engagement-docs', true)
  on conflict (id) do nothing;

  drop policy if exists "engagement docs read"   on storage.objects;
  drop policy if exists "engagement docs insert" on storage.objects;
  drop policy if exists "engagement docs update" on storage.objects;

  create policy "engagement docs read" on storage.objects
    for select to public using (bucket_id = 'engagement-docs');
  create policy "engagement docs insert" on storage.objects
    for insert to authenticated with check (bucket_id = 'engagement-docs');
  create policy "engagement docs update" on storage.objects
    for update to authenticated using (bucket_id = 'engagement-docs');
exception when others then
  raise notice 'storage bucket/policy setup skipped: %', sqlerrm;
end $$;

-- ---------- record an uploaded document against an engagement ----------
create or replace function public.add_engagement_document(
  p_eng_ref text, p_name text, p_path text, p_who text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; e_id uuid;
begin
  perform public.assert_access('crm', 2);
  if nullif(trim(coalesce(p_path, '')), '') is null then raise exception 'A document file is required'; end if;
  select id into e_id from public.engagements where ref = p_eng_ref;
  if e_id is null then raise exception 'Unknown engagement: %', p_eng_ref; end if;
  insert into public.engagement_documents(engagement_id, name, path, who)
  values (e_id, coalesce(nullif(trim(p_name), ''), 'Document'), trim(p_path), nullif(trim(coalesce(p_who,'')),''))
  returning id into v_id;
  perform public.audit_write('crm.engagement_document', 'engagement', p_eng_ref,
    jsonb_build_object('name', p_name, 'path', p_path));
  return jsonb_build_object('id', v_id, 'ref', p_eng_ref, 'name', p_name, 'path', p_path);
end $$;

-- ---------- grant: authenticated only, never public/anon ----------
do $$
begin
  revoke execute on function public.add_engagement_document(text, text, text, text) from public, anon;
  grant  execute on function public.add_engagement_document(text, text, text, text) to authenticated;
end $$;
