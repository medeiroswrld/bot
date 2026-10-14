-- 114 — faxina de mídia, toda madrugada
--
-- ── Por que isto existe ───────────────────────────────────────────────────
--
-- Em 2026-10-14 o projeto caiu. A causa raiz não foi técnica: o storage passou
-- de 1 GB para 2,9 GB no plano gratuito, isso virou fatura, a fatura não foi
-- vista e o projeto foi pausado por horas.
--
-- E o crescimento não tinha freio. Toda foto que um cliente manda numa conversa
-- ficava guardada para sempre, e toda foto de carro continuava ocupando espaço
-- anos depois de o carro ter sido vendido. Com duas lojas já eram 2,9 GB.
--
-- A primeira passada liberou 570 MB sem um erro: 152 arquivos de carro vendido
-- e 1.232 de conversa fria.
--
-- ── 3h17, e não 3h ────────────────────────────────────────────────────────
--
-- Horário quebrado de propósito, para não cair junto com a faxina de logs
-- (04:17) nem com a expiração de testes (06:00). Duas tarefas pesadas no mesmo
-- minuto competem pelo mesmo banco pequeno — que é justamente o que derrubou
-- o sistema neste mesmo dia.

select cron.unschedule('faxina-midia-diaria')
 where exists (select 1 from cron.job where jobname = 'faxina-midia-diaria');

select cron.schedule(
  'faxina-midia-diaria',
  '17 3 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://silmopooaspcpyquhmsw.supabase.co/functions/v1/faxina-midia',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    -- A primeira passada levou 130s porque tinha backlog de meses. As diárias
    -- vão ser curtas, mas o teto generoso evita que um dia atípico mate a
    -- faxina no meio e deixe metade do lixo para trás.
    timeout_milliseconds := 240000
  );
  $$
);
