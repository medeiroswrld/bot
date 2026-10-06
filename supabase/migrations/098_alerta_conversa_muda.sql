-- 098 — alarme para conversa que ficou muda
--
-- Em dois dias apareceram dois defeitos que calavam o bot sem deixar rastro:
--
--   1. O eco do proprio envio marcava a conversa como humana e o bot parava
--      no meio do atendimento.
--   2. A mensagem que chegava durante a geracao tinha a chave queimada por
--      uma invocacao que nao processava nada, e sumia.
--
-- Os dois sangraram lead por semanas. Nenhum dos dois gerou UM erro sequer —
-- foram descobertos porque o lojista leu uma conversa por acaso.
--
-- O que falta nao e mais trava. E perceber.
--
-- ── O que conta como "muda" ────────────────────────────────────────────────
--
-- Conversa em que a ULTIMA mensagem e do cliente, ha mais de 10 minutos, e o
-- status e `bot`. O status importa: `human` significa que alguem assumiu e a
-- demora e decisao de gente; `pending` significa que o bot esta impedido de
-- propósito (fora do horario, plano, suspensao). Só `bot` quer dizer "era pra
-- ter respondido e nao respondeu".
--
-- Dez minutos porque o bot normal responde em segundos, e o debounce de lote
-- leva no maximo cerca de um minuto. Dez e folga larga o bastante para nao
-- gritar por nada.
--
-- Teto de 6 horas para nao ressuscitar conversa velha quando o alarme for
-- ligado pela primeira vez — senao o primeiro disparo notificaria meses de
-- historico de uma vez.

alter table public.conversations
  add column if not exists alerta_mudo_em timestamptz;

comment on column public.conversations.alerta_mudo_em is
  'Quando avisamos que esta conversa ficou sem resposta. Existe para nao avisar duas vezes a mesma.';

create or replace view public.conversas_mudas as
  select c.id,
         c.user_id,
         c.customer_name,
         c.customer_phone,
         c.channel,
         c.last_message_at
    from public.conversations c
   where c.status = 'bot'
     and c.alerta_mudo_em is null
     and c.last_message_at < now() - interval '10 minutes'
     and c.last_message_at > now() - interval '6 hours'
     and (select m.role
            from public.messages m
           where m.conversation_id = c.id
           order by m.created_at desc
           limit 1) = 'customer';

comment on view public.conversas_mudas is
  'Conversas em que o cliente falou por ultimo e o bot, que deveria responder, nao respondeu. Base do alarme.';

alter view public.conversas_mudas set (security_invoker = on);

-- Indice para a consulta do alarme nao varrer a tabela inteira a cada rodada.
create index if not exists idx_conversas_mudas
  on public.conversations (status, last_message_at)
  where alerta_mudo_em is null;
