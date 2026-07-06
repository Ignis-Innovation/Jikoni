-- ============================================================
-- Jikoni Master PRD — Phase 5: Access & governance (enforce last)
-- Role templates, invite flow, SoD wired into the checkpoints that
-- have existed since Phase 0, grant-time conflict blocking,
-- onboarding/offboarding. Finally: enforce_access flips ON.
-- (enforce_sod stays off by default — flipping it blocks self-approval,
-- which the single-admin demo flow relies on; it is one config row away.)
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- role templates (matrix defaults; matches data.ts roleTemplates + inventory) ----------
create table if not exists public.role_templates (
  role_key text not null,
  module   text not null,
  level    int  not null check (level between 0 and 3),
  primary key (role_key, module)
);

insert into public.role_templates(role_key, module, level)
select r, m, l from (values
  ('admin', '{"finance":3,"procurement":3,"hr":3,"deploy":3,"readiness":3,"raise":3,"crm":3,"projects":3,"reports":3,"dataroom":3,"settings":3,"users":3,"inventory":3}'::jsonb),
  ('fin',   '{"finance":3,"procurement":3,"hr":1,"deploy":1,"readiness":0,"raise":0,"crm":1,"projects":2,"reports":2,"dataroom":0,"settings":0,"users":0,"inventory":3}'::jsonb),
  ('std',   '{"finance":0,"procurement":1,"hr":0,"deploy":1,"readiness":1,"raise":1,"crm":3,"projects":1,"reports":1,"dataroom":0,"settings":0,"users":0,"inventory":1}'::jsonb),
  ('view',  '{"finance":0,"procurement":0,"hr":0,"deploy":1,"readiness":1,"raise":0,"crm":1,"projects":0,"reports":1,"dataroom":0,"settings":0,"users":0,"inventory":0}'::jsonb)
) as t(r, perms), lateral (select key as m, value::text::int as l from jsonb_each(perms)) kv
on conflict (role_key, module) do nothing;

-- backfill the new inventory module into existing per-user grants (from each user's role template)
insert into public.user_permissions(email, module, level)
select u.email, 'inventory', rt.level
from public.app_users u
join public.role_templates rt on rt.role_key = u.role_key and rt.module = 'inventory'
on conflict (email, module) do nothing;

-- ---------- invites: invite → email → set password → (2FA at provider) ----------
create table if not exists public.invites (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  email      text not null unique,
  name       text not null,
  role_key   text not null default 'view',
  token      uuid not null default gen_random_uuid(),
  invited_by uuid references public.app_users(id),
  state      text not null default 'sent' check (state in ('sent','accepted','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.record_transitions(record_type, from_state, to_state) values
  ('invite','sent','accepted'), ('invite','sent','revoked'),
  ('app_user','invited','active'), ('app_user','active','exited'), ('app_user','invited','exited')
on conflict do nothing;

do $$
begin
  execute 'drop trigger if exists state_machine on public.invites';
  execute format('create trigger state_machine before update of state on public.invites
                  for each row execute function public.enforce_state_machine(%L)', 'invite');
end $$;

-- invite: creates the app_user from the LEAST-PRIVILEGE template + records the invite.
-- The auth account is provisioned by scripts/provision-invites.mjs (service role) which
-- emails the set-password link; on signup the Phase 0 trigger links auth_id and the
-- extension below marks the invite accepted.
create or replace function public.invite_user(p_name text, p_email text, p_role_key text default 'view')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_token uuid;
begin
  perform public.assert_access('users', 3);
  if exists (select 1 from public.app_users where email = p_email) then
    raise exception 'A user with % already exists', p_email;
  end if;
  if not exists (select 1 from public.role_templates where role_key = p_role_key) then
    raise exception 'Unknown role template: %', p_role_key;
  end if;
  insert into public.app_users(entity_id, name, email, role_key, status, state)
  values (v_entity, p_name, p_email, p_role_key, 'off', 'invited');
  insert into public.user_permissions(email, module, level)
  select p_email, module, level from public.role_templates where role_key = p_role_key
  on conflict (email, module) do update set level = excluded.level;
  insert into public.invites(entity_id, email, name, role_key, invited_by)
  values (v_entity, p_email, p_name, p_role_key, v_me)
  returning token into v_token;
  perform public.audit_write('user.invited','user', p_email,
    jsonb_build_object('name', p_name, 'role', p_role_key));
  return jsonb_build_object('email', p_email, 'name', p_name, 'role', p_role_key, 'token', v_token);
end $$;

-- extend the auth-link trigger: signing up also accepts the invite
create or replace function public.link_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.app_users set auth_id = new.id, state = 'active', status = 'active', updated_at = now()
  where email = new.email and auth_id is null;
  update public.invites set state = 'accepted', updated_at = now()
  where email = new.email and state = 'sent';
  return new;
end $$;

-- ---------- SoD: grant-time conflict blocking ----------
create table if not exists public.sod_conflicts (
  module_a text not null,
  level_a  int  not null,
  module_b text not null,
  level_b  int  not null,
  rule     text not null,
  primary key (module_a, module_b)
);

insert into public.sod_conflicts(module_a, level_a, module_b, level_b, rule) values
  ('procurement', 3, 'finance', 3, 'Full procurement (raise/approve PO) + full finance (pay) in one person'),
  ('hr', 3, 'finance', 3, 'Prepare payroll + post/pay payroll in one person'),
  ('users', 3, 'finance', 3, 'Grant own access + move money in one person')
on conflict (module_a, module_b) do nothing;

create or replace function public.save_access(p_email text, p_perms jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  k text; c record;
  v_sod boolean := coalesce((select value::text = 'true' from public.app_config where key = 'enforce_sod'), false);
begin
  perform public.assert_access('users', 3);
  if v_sod then
    for c in select * from public.sod_conflicts loop
      if coalesce((p_perms->>c.module_a)::int, 0) >= c.level_a
         and coalesce((p_perms->>c.module_b)::int, 0) >= c.level_b then
        raise exception 'Segregation of duties conflict: %', c.rule;
      end if;
    end loop;
  end if;
  for k in select jsonb_object_keys(p_perms) loop
    insert into public.user_permissions(email, module, level)
    values (p_email, k, (p_perms->>k)::int)
    on conflict (email, module) do update set level = excluded.level, updated_at = now();
  end loop;
  perform public.audit_write('access.updated','user', p_email, jsonb_build_object('perms', p_perms));
end $$;

-- ---------- SoD wired into the Phase 1 checkpoints ----------
create or replace function public.approve_requisition(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform public.assert_access('procurement', 3);
  select * into r from public.requisitions where ref = p_ref;
  if not found then raise exception 'Requisition % not found', p_ref; end if;
  perform public.assert_sod('requisition (requester ≠ approver)', r.owner_id);
  update public.requisitions set state = 'approved' where id = r.id;
  perform public.audit_write('requisition.approved','requisition', p_ref,
    jsonb_build_object('from', r.state));
  return jsonb_build_object('id', p_ref, 'status', 'approved');
end $$;

create or replace function public.submit_grn(p_po_ref text, p_coverage text, p_pct int, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  po record; req_owner uuid; v_ref text; total_pct int;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_receiver uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  select * into po from public.purchase_orders where ref = p_po_ref;
  if not found then raise exception 'PO % not found', p_po_ref; end if;
  if po.state = 'closed' then raise exception 'PO % is closed', p_po_ref; end if;
  select owner_id into req_owner from public.requisitions where id = po.requisition_id;
  perform public.assert_sod('goods receipt (receiver ≠ requester)', req_owner);
  v_ref := public.next_ref('GRN');
  insert into public.goods_received_notes(ref, entity_id, po_id, receiver_id, coverage, pct, note)
  values (v_ref, v_entity, po.id, v_receiver,
          case when p_coverage = 'full' then 'full' else 'partial' end,
          case when p_coverage = 'full' then 100 else least(greatest(p_pct,1),99) end, p_note);
  select coalesce(sum(pct),0) into total_pct from public.goods_received_notes where po_id = po.id and state='received';
  if po.state = 'open' and total_pct < 100 then
    update public.purchase_orders set state = 'partially_received' where id = po.id;
  end if;
  perform public.audit_write('grn.received','grn', v_ref,
    jsonb_build_object('po', p_po_ref, 'coverage', p_coverage, 'pct', p_pct));
  return jsonb_build_object('id', v_ref, 'po', p_po_ref, 'totalPct', least(total_pct,100));
end $$;

-- ---------- onboarding / offboarding (B9) ----------
create or replace function public.offboard_user(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u record;
begin
  perform public.assert_access('users', 3);
  select * into u from public.app_users where email = p_email;
  if not found then raise exception 'User % not found', p_email; end if;
  update public.app_users set state = 'exited', status = 'off' where id = u.id;
  update public.user_permissions set level = 0, updated_at = now() where email = p_email;
  update public.staff_files set state = 'exited' where app_user_id = u.id and state = 'active';
  update public.dataroom_grants set state = 'revoked' where grantee = p_email and state = 'active';
  update public.invites set state = 'revoked' where email = p_email and state = 'sent';
  -- audit history is retained by design (append-only)
  perform public.audit_write('user.offboarded','user', p_email,
    jsonb_build_object('name', u.name));
  return jsonb_build_object('email', p_email, 'state', 'exited');
end $$;

-- app_users gets a state machine too (was free default before)
do $$
begin
  execute 'drop trigger if exists state_machine on public.app_users';
  execute format('create trigger state_machine before update of state on public.app_users
                  for each row execute function public.enforce_state_machine(%L)', 'app_user');
end $$;

-- ---------- RLS + grants + THE FLIP ----------
do $$
declare t text;
begin
  foreach t in array array['role_templates','invites','sod_conflicts']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array['invite_user(text,text,text)','offboard_user(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ---------- system actions bypass the user permission hook ----------
-- e.g. the reorder loop raises a requisition from inside issue_stock; the
-- issuing clerk may hold inventory rights but not procurement rights.
create or replace function public.assert_access(p_module text, p_min_level int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_on boolean := coalesce((select value::text = 'true' from public.app_config where key = 'enforce_access'), false);
  v_email text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '');
  v_level int;
begin
  if not v_on then return; end if;
  if coalesce(current_setting('jikoni.system_action', true), '') = 'true' then return; end if;
  select level into v_level from public.user_permissions where email = v_email and module = p_module;
  if coalesce(v_level, 0) < p_min_level then
    raise exception 'Access denied: % requires level % on %', coalesce(nullif(v_email,''),'(no user)'), p_min_level, p_module;
  end if;
end $$;

create or replace function public.check_reorder(p_item uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  it record; on_hand numeric; req jsonb;
begin
  select * into it from public.stock_items where id = p_item;
  select coalesce(sum(qty), 0) into on_hand from public.stock_levels where item_id = p_item;
  if it.state = 'active' and it.reorder_level > 0 and on_hand < it.reorder_level
     and it.auto_req_ref is null and it.budget_code is not null and it.reorder_qty > 0 then
    perform set_config('jikoni.system_action', 'true', true);
    req := public.submit_requisition(
      format('Restock %s — %s %s (auto: below reorder level %s, on hand %s)',
             it.name, it.reorder_qty, it.unit, it.reorder_level, on_hand),
      it.reorder_qty * it.unit_cost, it.budget_code);
    perform set_config('jikoni.system_action', '', true);
    update public.stock_items set auto_req_ref = req->>'id' where id = p_item;
    perform public.audit_write('inventory.reorder_triggered','stock_item', it.sku,
      jsonb_build_object('onHand', on_hand, 'reorderLevel', it.reorder_level, 'requisition', req->>'id'));
    return req->>'id';
  end if;
  if on_hand >= it.reorder_level and it.auto_req_ref is not null then
    update public.stock_items set auto_req_ref = null where id = p_item;
  end if;
  return null;
end $$;

-- Phase 5, per the PRD: enforcement switches ON at checkpoints that have
-- been in every transition since Phase 0 — not a rebuild.
update public.app_config set value = 'true'::jsonb, updated_at = now() where key = 'enforce_access';
