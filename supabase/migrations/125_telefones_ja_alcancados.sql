-- ============================================================================
-- 125 — Quem a loja JÁ alcançou com um template, por qualquer caminho
-- ============================================================================
--
-- ── O buraco ──────────────────────────────────────────────────────────────
--
-- O filtro "pular quem já recebeu" olhava SÓ `campaign_sends`. Mas template
-- não sai só por campanha — cinco funções mandam template:
--
--   send-campaign            -> grava em campaign_sends
--   notify-waiting-list-match-> grava messages.envio_ativo = 'lista_espera'
--   iniciar-conversa         -> grava messages.envio_ativo = 'iniciada'
--   send-visit-reminders     -> NÃO grava mensagem; marca appointments.reminder_sent_at
--   send-birthday-messages   -> NÃO grava NADA (ver abaixo)
--
-- Ou seja: quem recebeu o aviso de um carro que entrou, ou o lembrete da
-- visita, contava como "nunca recebeu nada" e levaria o disparo em cima.
--
-- Medido na DSC em 27/11: dos 88 da base importada nunca tentados, ZERO
-- tinham recebido por outro caminho. Hoje não muda nada — e é exatamente por
-- isso que vale fechar agora, antes de a primeira pessoa cair nos dois.
--
-- ── Por que uma VIEW e não três consultas na função ───────────────────────
--
-- 1. Dá pra conferir o número no banco antes de confiar nele. Três consultas
--    encadeadas no PostgREST (uma delas com join embutido, sintaxe que este
--    projeto nunca usou) só se testam em produção — e o modo de falha é o pior
--    possível: a consulta erra, o conjunto de exclusão volta vazio, e o
--    disparo vai pra todo mundo.
-- 2. A tela e o servidor passam a ler a MESMA fonte. Quando as duas regras
--    viviam duplicadas, elas divergiram e 129 pessoas receberam repetido.
-- 3. O dia em que surgir uma sexta porta de envio, muda aqui e os dois lados
--    acompanham.
--
-- `security_invoker = true`: a view roda com a permissão de quem consulta,
-- então o RLS das tabelas de baixo continua valendo e a tela de uma loja nunca
-- enxerga telefone de outra.
--
-- ── O que esta view NÃO cobre ─────────────────────────────────────────────
--
-- `send-birthday-messages` manda template e não registra em lugar nenhum —
-- nem mensagem, nem marca no lead. Não dá pra saber quem recebeu aniversário.
-- Fica fora de propósito, e anotado: enquanto for assim, essa porta não é
-- auditável. Consertar é dar a ela o mesmo `envio_ativo` das outras.
--
-- Idempotente: pode ser reexecutada sem erro.
-- ============================================================================

drop view if exists public.telefones_ja_alcancados;

create view public.telefones_ja_alcancados
with (security_invoker = true) as
  -- 1. Campanha (disparo em massa). Inclui a TENTATIVA: `status` fica de fora
  --    de propósito, pra quem quiser excluir também quem levou falha.
  select
    cp.user_id,
    regexp_replace(coalesce(cs.customer_phone, ''), '\D', '', 'g') as telefone,
    cs.status                                                      as situacao,
    'campanha'::text                                               as origem
  from public.campaign_sends cs
  join public.campaigns cp on cp.id = cs.campaign_id

  union all

  -- 2. Envio ativo sem campanha: aviso da lista de espera e conversa iniciada
  --    à mão. Os dois são template, e os dois contam.
  select
    c.user_id,
    regexp_replace(coalesce(c.customer_phone, ''), '\D', '', 'g'),
    coalesce(m.wa_status, 'sent'),
    'envio_ativo'
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where m.envio_ativo is not null

  union all

  -- 3. Lembrete de visita. Esta função não grava mensagem; a prova de que o
  --    template saiu é o carimbo no próprio agendamento.
  select
    a.user_id,
    regexp_replace(coalesce(a.customer_phone, ''), '\D', '', 'g'),
    'sent',
    'lembrete_visita'
  from public.appointments a
  where a.reminder_sent_at is not null;

comment on view public.telefones_ja_alcancados is
  'Todo telefone que já recebeu (ou que a loja já tentou alcançar com) um template, por QUALQUER porta: campanha, aviso de lista de espera, conversa iniciada à mão e lembrete de visita. `situacao` permite separar entregue de falha. Aniversário não entra porque aquela função não registra o envio.';

-- O índice que falta pro caminho 3: o lembrete filtra por carimbo preenchido,
-- que é a minoria das linhas.
create index if not exists appointments_reminder_sent_idx
  on public.appointments (user_id)
  where reminder_sent_at is not null;
