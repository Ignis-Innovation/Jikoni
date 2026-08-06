-- Expose each project's last-updated timestamp so the registry can show a
-- "Last update" column and the dashboard can flag projects with no recent
-- activity (Elizabeth's review: stronger project summaries + Needs Attention).
-- Only adds 'updatedAt' to the existing projection — everything else is 1:1
-- with 0043. Idempotent (create or replace).

create or replace function public.project_detail_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'state', p.state,
    'funder', p.funder, 'status', p.status, 'budget', p.budget_txt, 'spent', p.spent_txt,
    'pct', p.pct, 'timeline', p.timeline, 'team', p.team, 'reporting', p.reporting, 'field', p.field,
    'budgetAmount', p.budget_amount,
    'spentAmount', coalesce((select sum(amount) from public.project_milestones
                             where project_id = p.id and status = 'done'), 0),
    'startDate', p.start_date, 'endDate', p.end_date,
    'updatedAt', p.updated_at,
    'location', p.location, 'docs', p.docs,
    'createdByMe', (
      (p.created_by is not null and p.created_by = (select id from public.app_users where auth_id = auth.uid()))
      or coalesce((select level from public.user_permissions
                   where email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
                     and module = 'projects'), 0) >= 3
    ),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 's', status,
                             'amount', amount, 'start', start_date, 'end', end_date) order by sort)
                            from public.project_milestones where project_id = p.id), '[]'::jsonb),
    'drawdowns',  coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 'v', amount_txt, 's', status) order by sort)
                            from public.project_drawdowns where project_id = p.id), '[]'::jsonb))
  from public.projects p where p.id = p_id
$$;
