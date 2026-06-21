-- ============================================================================
-- CRON: send-visit-reminders (a cada 2 minutos)
-- Rodar no SQL Editor. Requer pg_cron e pg_net habilitados.
-- Aplique POR ÚLTIMO — depois de 022/023/024 e do deploy da função
-- send-visit-reminders (senão o cron chama uma função inexistente).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('send-visit-reminders-2min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-visit-reminders-2min');

SELECT cron.schedule(
  'send-visit-reminders-2min',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://silmopooaspcpyquhmsw.supabase.co/functions/v1/send-visit-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
