-- 109 — follow-up do lead que esfriou
--
-- ── O que isto resolve ─────────────────────────────────────────────────────
--
-- O cliente pergunta do carro, o bot responde, manda foto, e ele some. Hoje
-- ninguém volta a falar com ele — nunca. O lead morre em silêncio e a loja nem
-- sabe quantos perdeu assim.
--
-- ── Por que DENTRO das 24h, e por que isso é de graça ──────────────────────
--
-- A Meta cobra por TEMPLATE, não por mensagem. Dentro da janela de atendimento
-- de 24 horas, mensagem de texto livre é gratuita e não precisa de aprovação
-- nenhuma ("All non-template messages are free", docs da Meta). Fora da janela,
-- só template — que custa por envio e passa por aprovação.
--
-- Por isso este follow-up vive inteiro dentro das 24h: custo zero, nos DOIS
-- canais, e no ar sem esperar a Meta aprovar nada. O follow-up de fora da
-- janela é outro recurso, com outra conta — e no Instagram ele é impossível,
-- porque lá não existe disparo e a janela é definitiva.
--
-- ── A janela conta da última mensagem DO CLIENTE ───────────────────────────
--
-- Não de `last_message_at`, que inclui as nossas. Se o bot respondeu 15:00 e o
-- cliente escreveu 14:00, a janela fecha às 14:00 do dia seguinte — não às
-- 15:00. Usar o campo errado faz a mensagem ser recusada no WhatsApp e
-- simplesmente não ser entregue no Instagram, as duas SEM erro visível na
-- tela. Silêncio é o modo de falha mais caro deste produto.
--
-- A margem de 22h (e não 24) existe pelo mesmo motivo: entre o cron selecionar
-- e a mensagem sair, o relógio anda.

alter table public.company_settings
  add column if not exists followup_enabled boolean not null default false,
  add column if not exists followup_horas   int     not null default 3,
  add column if not exists followup_mensagem text;

comment on column public.company_settings.followup_enabled is
  'Se o assistente volta a falar sozinho com quem esfriou. Desligado por padrao: muda como a loja fala com o cliente, e isso e decisao do lojista.';
comment on column public.company_settings.followup_horas is
  'Horas de silencio do cliente antes do follow-up. Conta da ultima mensagem DELE.';
comment on column public.company_settings.followup_mensagem is
  'Texto fixo do follow-up. Nulo usa o padrao. Fixo de proposito: sem chamada de modelo, o follow-up nao tem custo marginal nenhum.';

alter table public.conversations
  add column if not exists followup_em timestamptz;

comment on column public.conversations.followup_em is
  'Quando o follow-up foi enviado. Nao-nulo barra um segundo para sempre — insistir e o que faz o cliente bloquear o numero da loja.';

-- Índice do caminho quente: o cron varre `messages` por conversa a cada meia
-- hora, e sem isto a varredura cresce com o histórico inteiro da base.
create index if not exists idx_messages_conversa_role_data
  on public.messages (conversation_id, role, created_at desc);

-- ── Quem está elegível ─────────────────────────────────────────────────────
--
-- A seleção mora aqui, e não dentro da função, por dois motivos: dá para
-- conferir no banco quantas conversas entrariam ANTES de ligar para alguém, e
-- a regra fica legível para quem for mexer nela depois.

create or replace view public.conversas_para_followup as
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
  c.customer_phone,
  c.phone_number_id,
  u.ultima_do_cliente,
  u.msgs_do_cliente,
  cs.followup_mensagem
from public.conversations c
join ultimas u            on u.conversation_id = c.id
join public.company_settings cs on cs.user_id = c.user_id
where cs.followup_enabled = true
  -- Com o bot. Se um atendente assumiu, o bot nao atropela a conversa dele.
  and c.status = 'bot'
  -- Uma vez so, para sempre.
  and c.followup_em is null
  -- Conversa de verdade: quem mandou "oi" e sumiu nao recebe nada.
  and u.msgs_do_cliente >= 2
  -- A ultima palavra foi NOSSA. Se ele respondeu por ultimo, nao esfriou —
  -- ou esta esperando resposta, que e outro problema (o alerta de conversa
  -- muda cuida desse).
  and u.ultima_qualquer > u.ultima_do_cliente
  -- Esfriou o bastante...
  and u.ultima_do_cliente < now() - make_interval(hours => cs.followup_horas)
  -- ...mas a janela de 24h ainda esta aberta, com margem.
  and u.ultima_do_cliente > now() - interval '22 hours';

comment on view public.conversas_para_followup is
  'Conversas que esfriaram e ainda estao dentro da janela de 24h. A janela conta da ultima mensagem DO CLIENTE.';

-- Só o servidor lê isto. O lojista não tem o que fazer com a lista crua.
revoke all on public.conversas_para_followup from anon, authenticated;
