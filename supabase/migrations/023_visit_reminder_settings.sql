-- 023_visit_reminder_settings.sql
-- Configuração do lembrete de visita por concessionária.
--   visit_reminder_enabled:        liga/desliga (default OFF — só ativa quando
--                                  o template lembrete_visita for aprovado).
--   visit_reminder_minutes_before: quantos minutos antes enviar (15/30/60/120).
-- Idempotente.

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS visit_reminder_enabled        boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS visit_reminder_minutes_before integer DEFAULT 15;
