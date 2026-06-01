-- ============================================================================
-- 0025_fix_sequence_security.sql
-- next_human_id() writes to id_sequences (RLS-protected). It must run as
-- SECURITY DEFINER so human-code generation works under a normal user session.
-- ============================================================================

create or replace function public.next_human_id(p_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_val bigint;
  v_pad int;
begin
  insert into public.id_sequences(prefix) values (p_prefix)
    on conflict (prefix) do nothing;

  update public.id_sequences
     set next_val = next_val + 1
   where prefix = p_prefix
  returning next_val - 1, pad into v_val, v_pad;

  return p_prefix || '-' || lpad(v_val::text, v_pad, '0');
end;
$$;
