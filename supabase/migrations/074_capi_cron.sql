-- 074 — cron do envio de conversões
--
-- SEPARADA da 073 de propósito: esta agenda chamadas HTTP pra uma function que
-- precisa existir antes. Rodar isto com a `enviar-capi` ainda não deployada
-- gera erro a cada 10 minutos até alguém perceber.
--
-- ORDEM: rodar a 073 → deployar `enviar-capi` → rodar esta.
--
-- A cada 10 minutos, e não a cada minuto: nada aqui é urgente. A Meta usa o
-- `event_time` que mandamos, não a hora em que a requisição chega, então
-- atrasar dez minutos não muda atribuição nenhuma — só reduz chamada à toa.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('enviar-capi-10min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'enviar-capi-10min');

SELECT cron.schedule(
  'enviar-capi-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://silmopooaspcpyquhmsw.supabase.co/functions/v1/enviar-capi',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);
