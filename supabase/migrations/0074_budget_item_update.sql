-- ============================================================
-- 0074 — Projects: edit a budget item
-- Adds update_project_budget_item so the IRENA Budget tab can edit an existing
-- allocation (name / description / amount), recomputing budget_amount. Edit-gated
-- via assert_access('projects', 2) — same as add/delete. Idempotent.
-- ============================================================

create or replace function public.update_project_budget_item(
  p_id uuid, p_name text, p_description text, p_amount numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  perform public.assert_access('projects', 2);
  select project_id into v_project from public.project_budget_items where id = p_id;
  if v_project is null then raise exception 'Budget item not found'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'A budget item name is required';
  end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Amount must be zero or more'; end if;
  update public.project_budget_items
     set name = trim(p_name),
         description = nullif(trim(coalesce(p_description, '')), ''),
         amount = coalesce(p_amount, 0)
   where id = p_id;
  perform public.recompute_project_budget(v_project);
  perform public.audit_write('project.budget_item_updated', 'project', v_project::text,
    jsonb_build_object('item', p_id, 'name', p_name, 'amount', p_amount));
  return public.project_payload(v_project);
end $$;

revoke execute on function public.update_project_budget_item(uuid,text,text,numeric) from public, anon;
grant  execute on function public.update_project_budget_item(uuid,text,text,numeric) to authenticated;
