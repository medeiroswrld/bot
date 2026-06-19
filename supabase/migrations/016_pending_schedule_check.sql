-- 016_pending_schedule_check.sql
-- Registro pendente de "verificação de horário" feita pelo bot (vendedor).
-- Preenchido pela tool request_schedule_check; consumido pela edge function
-- check-pending-schedules (cron a cada 3 min). JSONB:
--   { requested_datetime, requested_at, customer_context }

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS pending_schedule_check jsonb;
