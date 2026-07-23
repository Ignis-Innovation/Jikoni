-- ============================================================
-- Jikoni — Partnerships CRM: rename the upstream (capital) stage ladder
-- The old ladder mixed relationship stages with artifacts ("Materials",
-- "Term sheet"). New solid ladder (all stages):
--   Discovery → Due diligence → Negotiation → Agreement → Commitment → Closed
-- Remap existing upstream engagements so the drawer's progress ribbon keeps
-- highlighting the right rung. Downstream is unchanged.
-- Idempotent: safe to re-run (old values simply no longer exist after the first run).
-- ============================================================

update public.engagements
   set stage = case stage
                 when 'Materials'  then 'Due diligence'
                 when 'Term sheet' then 'Agreement'
                 when 'Committed'  then 'Commitment'
                 else stage
               end,
       updated_at = now()
 where pipeline = 'up'
   and stage in ('Materials', 'Term sheet', 'Committed');
