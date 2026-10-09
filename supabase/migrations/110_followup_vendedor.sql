-- 110 — follow-up também na conversa que o vendedor largou
--
-- ── O que a 109 deixou de fora, e o tamanho disso ─────────────────────────
--
-- A 109 só alcançava conversa em `status = 'bot'`, para o assistente não
-- atropelar um vendedor no meio do atendimento. A intenção estava certa; a
-- régua, não. Medindo na DSC:
--
--     human   271
--     bot     137
--
-- Dois terços da base ficavam de fora. E o caso que mostrou isso era um lead
-- de verdade: 10 mensagens trocadas, o vendedor assumiu, respondeu, e às 3
-- horas de silêncio o lead estava esfriando sem que nada acontecesse.
--
-- Vendedor que falou há cinco horas não está conduzindo conversa nenhuma. O
-- que ele precisa é de uma régua mais longa que a do bot — não de exclusão.
--
-- ── Por que a devolução ao bot vem junto, e não como opção ────────────────
--
-- Numa conversa em `human` o assistente não responde. Mandar follow-up e
-- deixar o status como está criaria uma armadilha: o cliente recebe "e aí, o
-- que achou?", responde — e ninguém atende. Isso é pior que não ter mandado,
-- porque gasta a boa vontade dele e confirma que a loja não responde.
--
-- Então quem puxa o assunto assume a conversa. A função devolve para `bot` no
-- mesmo movimento do envio.
--
-- ── Nulo = desligado ──────────────────────────────────────────────────────
--
-- A coluna nasce nula de propósito: ninguém passa a falar com os clientes de
-- um jeito novo por causa de uma migration. O lojista liga quando quiser.

alter table public.company_settings
  add column if not exists followup_horas_vendedor int;

comment on column public.company_settings.followup_horas_vendedor is
  'Horas de silencio antes do follow-up quando um VENDEDOR assumiu a conversa. Separado de followup_horas porque merece regua mais longa. Nulo = nao faz follow-up em conversa de vendedor.';

-- `create or replace view` nao aceita coluna nova no MEIO da lista — ele
-- entende como renomear a que estava naquela posicao e recusa. Derrubar e
-- recriar e seguro aqui: so a funcao `enviar-followup` le esta view, e ela
-- seleciona `*`.
drop view if exists public.conversas_para_followup;

create view public.conversas_para_followup as
with ultimas as (
  select
    m.conversation_id,
    max(m.created_at) filter (where m.role = 'customer') as ultima_do_cliente,
    max(m.created_at)                                    as ultima_qualquer,
    count(*) filter (where m.role = 'customer')          as msgs_do_cliente
  from public.messages m
  group by m.conversation_id
)
select
  c.id   as conversation_id,
  c.user_id,
  c.channel,
  c.status,
  c.customer_phone,
  c.phone_number_id,
  u.ultima_do_cliente,
  u.msgs_do_cliente,
  cs.followup_mensagem
from public.conversations c
join ultimas u                  on u.conversation_id = c.id
join public.company_settings cs on cs.user_id = c.user_id
where cs.followup_enabled = true
  -- Uma vez so, para sempre. Insistir e o que faz o cliente bloquear a loja.
  and c.followup_em is null
  -- Conversa de verdade: quem mandou "oi" e sumiu nao recebe nada.
  and u.msgs_do_cliente >= 2
  -- A ultima palavra foi NOSSA (do bot ou do vendedor). Se ele respondeu por
  -- ultimo, nao esfriou — esta esperando resposta, que e outro problema e
  -- tem outro alarme.
  and u.ultima_qualquer > u.ultima_do_cliente
  -- Com o bot, ou com um vendedor que largou. `pending` fica de fora: ali o
  -- bot foi impedido de responder, e puxar assunto por cima disso seria
  -- falar justamente quando o sistema decidiu calar.
  and (
        c.status = 'bot'
     or (c.status = 'human' and cs.followup_horas_vendedor is not null)
      )
  -- Esfriou o bastante — com a regua de quem falou por ultimo.
  and u.ultima_do_cliente < now() - make_interval(hours =>
        case when c.status = 'human'
             then cs.followup_horas_vendedor
             else cs.followup_horas
        end)
  -- ...e a janela de 24h ainda esta aberta, com margem para o relogio andar
  -- entre o cron selecionar e a mensagem sair.
  and u.ultima_do_cliente > now() - interval '22 hours';

comment on view public.conversas_para_followup is
  'Conversas que esfriaram e ainda estao dentro da janela de 24h. A janela conta da ultima mensagem DO CLIENTE. Conversa de vendedor tem regua propria e so entra se a loja configurou uma.';

revoke all on public.conversas_para_followup from anon, authenticated;
