-- ============================================================
-- Jikoni — Field workforce: auto-generate the casual contract reference
-- The New-field-assignment form no longer asks for a per-diem total or a
-- contract/doc ref. create_field_assignment now mints the contract reference
-- itself (CAS-<year>-<seq>) from a ref counter when the caller doesn't pass one,
-- so every casual assignment gets a unique, sequential doc reference.
-- Idempotent: safe to re-run.
-- ============================================================

-- casual-contract counter. Seeds (0015) used CAS-2026-011..014 by hand, so start
-- at 14 and bump past the highest existing CAS-YYYY-NNN so the next mint can't collide.
insert into public.ref_counters(kind, prefix, n) values ('CAS', 'CAS-', 14)
on conflict (kind) do nothing;

update public.ref_counters c
   set n = greatest(c.n, coalesce((
     select max(split_part(contract_doc, '-', 3)::int)
     from public.field_assignments
     where contract_doc ~ '^CAS-\d+-\d+$'
   ), 0))
 where c.kind = 'CAS';

-- Same signature as 0015 (defaults preserved) so PostgREST callers that omit
-- p_per_diem / p_contract_doc still resolve; contract_doc is generated when absent.
create or replace function public.create_field_assignment(
  p_enumerator_id uuid, p_project text default null, p_period text default null,
  p_days numeric default 0, p_per_diem numeric default 0, p_contract_doc text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_doc text; v_seq int;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('hr', 2);
  if not exists (select 1 from public.enumerators where id = p_enumerator_id) then
    raise exception 'Unknown enumerator';
  end if;
  if p_project is not null and not exists (select 1 from public.projects where name = p_project) then
    raise exception 'Unknown project: %', p_project;
  end if;
  -- use the caller's reference if one was given, otherwise auto-mint CAS-<year>-<seq>
  v_doc := nullif(trim(coalesce(p_contract_doc, '')), '');
  if v_doc is null then
    update public.ref_counters set n = n + 1 where kind = 'CAS' returning n into v_seq;
    v_doc := 'CAS-' || extract(year from current_date)::int || '-' || lpad(v_seq::text, 3, '0');
  end if;
  insert into public.field_assignments(entity_id, enumerator_id, project_name, period, days, per_diem, contract_doc, state)
  values (v_entity, p_enumerator_id, p_project, nullif(trim(coalesce(p_period,'')),''), coalesce(p_days,0),
          coalesce(p_per_diem,0), v_doc, 'planned')
  returning id into v_id;
  perform public.audit_write('hr.field_assignment_created','field_assignment', v_id::text,
    jsonb_build_object('project', p_project, 'period', p_period, 'days', p_days, 'contractDoc', v_doc));
  return jsonb_build_object('id', v_id, 'project', p_project, 'contractDoc', v_doc, 'state', 'planned');
end $$;

grant execute on function public.create_field_assignment(uuid,text,text,numeric,numeric,text) to authenticated;
