-- 004_flexible_schedule.sql
-- Adiciona horários flexíveis por dia da semana e tabela de exceções/feriados.

-- 1. Nova coluna JSONB em company_settings
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS business_hours jsonb;

-- 2. Migra dados existentes (apenas onde business_hours ainda é NULL)
UPDATE company_settings
SET business_hours = jsonb_build_object(
  'mon', CASE WHEN COALESCE(working_days, '') LIKE '%Seg%'
              THEN jsonb_build_object('open', true,
                     'start', COALESCE(business_hours_start, '09:00'),
                     'end',   COALESCE(business_hours_end,   '18:00'))
              ELSE '{"open": false}'::jsonb END,
  'tue', CASE WHEN COALESCE(working_days, '') LIKE '%Ter%'
              THEN jsonb_build_object('open', true,
                     'start', COALESCE(business_hours_start, '09:00'),
                     'end',   COALESCE(business_hours_end,   '18:00'))
              ELSE '{"open": false}'::jsonb END,
  'wed', CASE WHEN COALESCE(working_days, '') LIKE '%Qua%'
              THEN jsonb_build_object('open', true,
                     'start', COALESCE(business_hours_start, '09:00'),
                     'end',   COALESCE(business_hours_end,   '18:00'))
              ELSE '{"open": false}'::jsonb END,
  'thu', CASE WHEN COALESCE(working_days, '') LIKE '%Qui%'
              THEN jsonb_build_object('open', true,
                     'start', COALESCE(business_hours_start, '09:00'),
                     'end',   COALESCE(business_hours_end,   '18:00'))
              ELSE '{"open": false}'::jsonb END,
  'fri', CASE WHEN COALESCE(working_days, '') LIKE '%Sex%'
              THEN jsonb_build_object('open', true,
                     'start', COALESCE(business_hours_start, '09:00'),
                     'end',   COALESCE(business_hours_end,   '18:00'))
              ELSE '{"open": false}'::jsonb END,
  'sat', CASE WHEN COALESCE(working_days, '') LIKE '%Sab%'
              THEN jsonb_build_object('open', true,
                     'start', COALESCE(business_hours_start, '09:00'),
                     'end',   COALESCE(business_hours_end,   '18:00'))
              ELSE '{"open": false}'::jsonb END,
  'sun', CASE WHEN COALESCE(working_days, '') LIKE '%Dom%'
              THEN jsonb_build_object('open', true,
                     'start', COALESCE(business_hours_start, '09:00'),
                     'end',   COALESCE(business_hours_end,   '18:00'))
              ELSE '{"open": false}'::jsonb END
)
WHERE business_hours IS NULL;

-- 3. Tabela de exceções e feriados
CREATE TABLE IF NOT EXISTS schedule_exceptions (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       date    NOT NULL,
  closed     boolean NOT NULL DEFAULT true,
  start_time text,
  end_time   text,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

-- 4. RLS
ALTER TABLE schedule_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schedule_exceptions_select"       ON schedule_exceptions;
DROP POLICY IF EXISTS "schedule_exceptions_insert"       ON schedule_exceptions;
DROP POLICY IF EXISTS "schedule_exceptions_update"       ON schedule_exceptions;
DROP POLICY IF EXISTS "schedule_exceptions_delete"       ON schedule_exceptions;
DROP POLICY IF EXISTS "schedule_exceptions_service_role" ON schedule_exceptions;

CREATE POLICY "schedule_exceptions_select"       ON schedule_exceptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "schedule_exceptions_insert"       ON schedule_exceptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "schedule_exceptions_update"       ON schedule_exceptions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "schedule_exceptions_delete"       ON schedule_exceptions FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "schedule_exceptions_service_role" ON schedule_exceptions FOR ALL  USING (auth.role() = 'service_role');

-- 5. Índice
CREATE INDEX IF NOT EXISTS schedule_exceptions_user_date_idx ON schedule_exceptions(user_id, date);
