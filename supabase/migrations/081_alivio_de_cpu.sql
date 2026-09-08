-- 081 — devolver a CPU do banco pro produto
--
-- Diagnóstico do Query Performance em 2026-09-05, com o banco a 90% de CPU e
-- apenas 105 MB de dados — desproporção que já indica desperdício, não volume.
--
--   59,4%  limpeza de net._http_response      (faxina do pg_net)
--   12,9%  realtime.list_changes              (CRM ao vivo)
--    6,2%  busca de mensagens do CRM
--    3,4%  insert em cron.job_run_details
--    2,6%  update em cron.job_run_details
--
-- Somando, ~65% do tempo do banco é CONTABILIDADE DOS NOSSOS PRÓPRIOS CRONS,
-- não trabalho de produto. A limpeza do pg_net chegou a 586 SEGUNDOS numa única
-- execução — quase dez minutos de CPU pra apagar linha de log.
--
-- A causa é composta: cinco crons batendo de 2 em 2, 3 em 3, 5 em 5 e 10 em 10
-- minutos, cada chamada gravando uma resposta HTTP numa tabela que incha, mais
-- duas linhas de log de execução. O trabalho útil de cada um dura milissegundos;
-- o rastro que deixam custa mais que eles.

-- ── 1. Esvaziar o que já inchou ─────────────────────────────────────────────
--
-- O pg_net guarda a resposta de cada net.http_post. Nós nunca lemos essas
-- respostas — os crons são fire-and-forget. Então tudo que passou da última
-- hora é lixo puro, e é justamente o que torna a faxina cara: quanto mais linha
-- morta, mais devagar a própria limpeza.
delete from net._http_response where created < now() - interval '1 hour';

-- Histórico de execução de cron. O pg_cron não limpa sozinho, então ele cresce
-- pra sempre. Duas semanas bastam pra investigar qualquer coisa.
delete from cron.job_run_details where end_time < now() - interval '14 days';

-- O VACUUM que recupera o espaço das linhas apagadas NÃO está aqui: ele não
-- roda dentro de transação, e o editor SQL envolve o script inteiro em uma.
-- Precisa ser executado sozinho, depois deste arquivo:
--
--   vacuum (analyze) net._http_response;
--   vacuum (analyze) cron.job_run_details;
--
-- Sem ele o alívio ainda acontece — o autovacuum chega lá —, só demora mais.
-- O ANALYZE no fim deste arquivo já atualiza as estatísticas do planejador,
-- que é a metade que funciona dentro de transação.

-- ── 2. Reduzir a frequência do que não precisa ser tão rápido ───────────────
--
-- Lembrete de visita rodava de 2 em 2 minutos: 30 execuções por hora pra avisar
-- de um compromisso marcado com horas de antecedência. A cada 5 minutos, o
-- lembrete pode sair no máximo 5 minutos depois do previsto — irrelevante pra
-- quem vai visitar a loja, e corta 60% das chamadas.
select cron.schedule(
  'send-visit-reminders-2min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://silmopooaspcpyquhmsw.supabase.co/functions/v1/send-visit-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);

-- Agendamento pendente rodava de 3 em 3. Este toca o cliente (é o "vou
-- confirmar com meu superior"), então subir demais pioraria a experiência —
-- 5 minutos é o teto do aceitável, e ainda assim corta 40% das chamadas.
select cron.schedule(
  'check-pending-schedules-3min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://silmopooaspcpyquhmsw.supabase.co/functions/v1/check-pending-schedules',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);

-- ── 3. Faxina recorrente, pra não voltar ────────────────────────────────────
--
-- A limpeza acima resolve hoje. Sem uma rotina, o inchaço volta em semanas e
-- alguém vai diagnosticar isso tudo de novo do zero.
--
-- 4h da manhã: fora do horário comercial de qualquer loja.
select cron.unschedule('faxina-logs-diaria')
where exists (select 1 from cron.job where jobname = 'faxina-logs-diaria');

select cron.schedule(
  'faxina-logs-diaria',
  '17 4 * * *',
  $$
  delete from net._http_response where created < now() - interval '1 hour';
  delete from cron.job_run_details where end_time < now() - interval '14 days';
  $$
);

-- ── 4. A consulta de mensagens do CRM ───────────────────────────────────────
--
-- 6,2% do tempo, 220 ms de média e pico de 7 segundos. O índice
-- (conversation_id, created_at) já existe desde a 002, então NÃO é falta de
-- índice: a tela pede as últimas mensagens de TODAS as conversas numa consulta
-- só (`conversation_id = ANY(...)` com a lista inteira), e o banco precisa
-- juntar dezenas de faixas do índice e ordenar tudo junto.
--
-- A correção de verdade é na tela — pedir a última de cada conversa, não uma
-- lista global. Fica anotado; mexer na consulta agora, junto de uma mudança de
-- infraestrutura, dificultaria saber o que melhorou.
--
-- Por ora, só garantir que o planejador tem estatística fresca.
analyze public.messages;
analyze public.conversations;
