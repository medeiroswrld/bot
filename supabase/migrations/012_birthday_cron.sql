-- ============================================================================
-- CRON DIÁRIO DE ANIVERSÁRIO
-- Rodar no SQL Editor do Supabase. Requer as extensões pg_cron e pg_net
-- (Dashboard → Database → Extensions → habilitar "pg_cron" e "pg_net").
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove agendamento anterior se existir (idempotente)
SELECT cron.unschedule('send-birthday-messages-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-birthday-messages-daily');

-- Agenda às 12h UTC = 9h de Brasília (UTC-3)
SELECT cron.schedule(
  'send-birthday-messages-daily',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://silmopooaspcpyquhmsw.supabase.co/functions/v1/send-birthday-messages',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ----------------------------------------------------------------------------
-- NOTA: se current_setting('app.settings.service_role_key') não estiver
-- disponível no seu projeto, substitua a linha do Authorization por um Bearer
-- com o SERVICE_ROLE_KEY literal, OU use o anon key — a função foi deployada
-- com --no-verify-jwt, então também funciona sem Authorization:
--
--   headers := jsonb_build_object('Content-Type', 'application/json')
--
-- Alternativa sem pg_cron: criar um Vercel Cron Job (vercel.json) que faz
-- POST diário para a mesma URL.
-- ----------------------------------------------------------------------------
