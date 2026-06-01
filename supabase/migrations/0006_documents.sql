-- ============================================================================
-- 0006_documents.sql — Phase 1E Documents (PRD §1E)
-- Attach + version any file against any record (entity_type + entity_id).
-- Files live in Supabase Storage bucket 'documents'.
-- ============================================================================

create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  filename     text not null,
  storage_path text not null,
  mime_type    text,
  size_bytes   bigint,
  version      int not null default 1,
  entity_type  text not null,        -- e.g. 'purchase_orders'
  entity_id    uuid not null,        -- the linked record's id
  uploaded_by  uuid references public.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.users(id),
  updated_by   uuid references public.users(id),
  deleted_at   timestamptz
);

create index on public.documents(entity_type, entity_id);

create table public.document_versions (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  version      int not null,
  storage_path text not null,
  uploaded_by  uuid references public.users(id),
  created_at   timestamptz not null default now()
);
