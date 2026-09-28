-- 0086: Ignis's real invoice bank accounts (from Finance, 2026-09-28).
-- Both accounts: KCB Bank Kenya, Sarit Centre branch. Idempotent (upsert).
insert into public.app_config(key, value, updated_at) values
  ('invoice_bank_usd', '{"account_name":"Ignis Innovation Limited","bank":"KCB Bank Kenya","account_no":"1342100026","branch":"Sarit Centre","swift":""}', now()),
  ('invoice_bank_kes', '{"account_name":"Ignis Innovation Limited","bank":"KCB Bank Kenya","account_no":"1342100093","branch":"Sarit Centre","swift":""}', now())
on conflict (key) do update set value = excluded.value, updated_at = now();
