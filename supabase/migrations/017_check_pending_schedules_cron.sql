-- ============================================================================
-- CRON: check-pending-schedules (a cada 3 minutos)
-- Rodar no SQL Editor do Supabase. Requer pg_cron e pg_net habilitados.
-- Aplique DEPOIS de 016/018 e do deploy da function check-pending-schedules.
-- Modelo igual ao cron de aniversário (012).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove agendamento anterior se existir (idempotente)
SELECT cron.unschedule('check-pending-schedules-3min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-pending-schedules-3min');

-- A cada 3 minutos
SELECT cron.schedule(
  'check-pending-schedules-3min',
  '*/3 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://silmopooaspcpyquhmsw.supabase.co/functions/v1/check-pending-schedules',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ----------------------------------------------------------------------------
-- NOTA: a function é deployada com --no-verify-jwt, então funciona mesmo sem o
-- Authorization. Se current_setting('app.settings.service_role_key') não
-- existir no projeto, pode trocar a linha do Authorization por:
--   headers := jsonb_build_object('Content-Type', 'application/json')
-- ----------------------------------------------------------------------------
