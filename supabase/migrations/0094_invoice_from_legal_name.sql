-- 0094: invoice header shows the full legal name "Ignis Innovation Limited"
-- (client request 2026-10-02). Updates the Settings header and the snapshot on
-- invoices already issued with the short name. Idempotent.
update public.app_config
   set value = value || '{"company":"Ignis Innovation Limited"}'::jsonb, updated_at = now()
 where key = 'invoice_from';

update public.sales_invoices
   set from_details = from_details || '{"company":"Ignis Innovation Limited"}'::jsonb
 where from_details->>'company' in ('Ignis Innovation', 'Ignis Innovation Ltd');
