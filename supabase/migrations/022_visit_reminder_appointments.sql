-- 022_visit_reminder_appointments.sql
-- Controle de lembrete de visita por appointment.
--   reminder_sent_at: quando o lembrete foi enviado (claim/dedup).
--   reminder_status:  'pending' | 'sent' | 'failed'.
--   notes:            defensivo — o handler cancelar_visita grava o motivo aqui
--                     (a tabela appointments é do schema inicial; IF NOT EXISTS
--                     é no-op se a coluna já existir).
-- Idempotente.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_status  text,
  ADD COLUMN IF NOT EXISTS notes            text;
