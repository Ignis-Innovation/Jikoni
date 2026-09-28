-- 0091: invoice "From" shows the company only — drop the personal signatory
-- (client request 2026-09-28). The PDF no longer prints a signatory either, so
-- invoices issued earlier with Dennis's name snapshotted also render without it.
update public.app_config set value = value - 'signatory', updated_at = now() where key = 'invoice_from';
