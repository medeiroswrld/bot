-- 113 — os três crons que só existiam no banco
--
-- ── Como isto foi descoberto ──────────────────────────────────────────────
--
-- Em 2026-10-14 o projeto travou em RESTORING por horas. Preparando a
-- recuperação, fui conferir o que o repositório conseguiria recriar sozinho e
-- achei o buraco: dos dez jobs agendados, SETE estão em migration e três
-- existiam só dentro do banco.
--
--     alerta-conversa-muda-15min
--     renovar-instagram-diario
--     followup-leads-30min
--
-- Restore não costuma trazer job do `pg_cron` de volta. Se não trouxesse, esses
-- três sumiriam e não haveria de onde recuperar — nem para consultar o horário
-- e o comando, porque a única cópia estava no banco que estava fora.
--
-- ── Por que o do Instagram é o mais grave ─────────────────────────────────
--
-- `renovar-instagram-diario` renova o token de 60 dias. Sem ele, o token vence
-- e o bot para de atender no Direct — sem erro, sem alarme, sem ninguém
-- perceber, 60 dias depois do dia em que o cron sumiu. É o modo de falha mais
-- caro deste produto, e ele estaria armado sem ninguém saber.
--
-- ── Idempotente de propósito ──────────────────────────────────────────────
--
-- `unschedule` antes de `schedule` para poder rodar isto com o job já
-- existente, sem criar duplicata. pg_cron não tem `if not exists`, e dois jobs
-- com o mesmo nome fariam o trabalho duas vezes — no caso do follow-up, duas
-- mensagens para o mesmo cliente.

-- ── Alarme de conversa muda ───────────────────────────────────────────────
-- Avisa quando um cliente ficou esperando. Nasceu dos dois defeitos de
-- outubro que calavam o bot sem gerar erro: sem alarme, a loja descobria pelo
-- cliente reclamando.
select cron.unschedule('alerta-conversa-muda-15min')
 where exists (select 1 from cron.job where jobname = 'alerta-conversa-muda-15min');

select cron.schedule(
  'alerta-conversa-muda-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://silmopooaspcpyquhmsw.supabase.co/functions/v1/alerta-conversa-muda',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Renovação do token do Instagram ───────────────────────────────────────
-- O token do Instagram morre em 60 dias. Este job renova antes disso,
-- inclusive os que foram colados à mão e não têm data de validade gravada.
select cron.unschedule('renovar-instagram-diario')
 where exists (select 1 from cron.job where jobname = 'renovar-instagram-diario');

select cron.schedule(
  'renovar-instagram-diario',
  '0 5 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://silmopooaspcpyquhmsw.supabase.co/functions/v1/renovar-instagram',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Follow-up do lead que esfriou ─────────────────────────────────────────
-- A meia hora é folgada de propósito: a elegibilidade é uma faixa de horas,
-- não um instante, então varrer com mais frequência só gastaria chamada.
select cron.unschedule('followup-leads-30min')
 where exists (select 1 from cron.job where jobname = 'followup-leads-30min');

select cron.schedule(
  'followup-leads-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://silmopooaspcpyquhmsw.supabase.co/functions/v1/enviar-followup',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);
