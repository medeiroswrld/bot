-- 072 — origem do lead: clique em anúncio (Click-to-WhatsApp)
--
-- Quando alguém toca num anúncio e cai no WhatsApp, a Meta anexa um bloco
-- `referral` à PRIMEIRA mensagem: qual anúncio, qual criativo, e o `ctwa_clid`
-- — o identificador daquele clique.
--
-- Duas coisas tornam isso urgente:
--
--   1. O campo só chega UMA VEZ. Segunda mensagem do mesmo cliente já não tem.
--      Não existe endpoint pra buscar depois. Perdeu, perdeu pra sempre.
--   2. Sem o ctwa_clid não há como devolver conversão pra Meta. É ele que
--      amarra "esta pessoa comprou" ao clique que a trouxe.
--
-- Até hoje o parseCloud lia `from`, `id` e `type` e descartava o resto — ou
-- seja, todo anúncio que a DSC rodou até agora virou lead sem origem.
--
-- TABELA e não duas colunas em `leads` de propósito: a mesma pessoa clica em
-- anúncios diferentes ao longo do tempo (não comprou em maio, volta em agosto
-- por outro carro). Coluna sobrescreve e mata a atribuição da compra anterior;
-- linha nova preserva as duas.

create table if not exists public.ad_referrals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  lead_id         uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,

  -- Idempotência: a Meta reentrega webhook quando não recebe 200 rápido o
  -- bastante, e reentrega significa o mesmo clique gravado duas vezes. Mesmo
  -- padrão das outras tabelas de evento do projeto.
  wa_message_id   text not null,

  -- O que importa pra atribuição.
  ctwa_clid       text,
  source_id       text,          -- id do anúncio
  source_type     text,          -- 'ad' ou 'post'
  source_url      text,

  -- O criativo. Não serve pra atribuição, serve pra CONVERSA: saber que o
  -- cliente veio do anúncio do Onix 2020 prata é contexto que o bot não tem
  -- hoje, e é a diferença entre "oi, como posso ajudar" e "vi que você se
  -- interessou pelo Onix".
  headline        text,
  body            text,
  media_type      text,
  image_url       text,
  video_url       text,
  thumbnail_url   text,

  created_at      timestamptz not null default now()
);

create unique index if not exists ad_referrals_msg_uniq
  on public.ad_referrals (user_id, wa_message_id);

create index if not exists ad_referrals_lead_idx
  on public.ad_referrals (lead_id);

create index if not exists ad_referrals_conv_idx
  on public.ad_referrals (conversation_id);

-- Busca pelo clique: usada na hora de montar o evento de volta pra Meta.
create index if not exists ad_referrals_clid_idx
  on public.ad_referrals (ctwa_clid)
  where ctwa_clid is not null;

-- Relatório por anúncio, que é a pergunta que o lojista faz ("qual anúncio
-- trouxe venda?").
create index if not exists ad_referrals_source_idx
  on public.ad_referrals (user_id, source_id, created_at desc);

comment on table public.ad_referrals is
  'Cliques em anúncio que viraram conversa. Uma linha por clique — nunca sobrescrever.';
comment on column public.ad_referrals.ctwa_clid is
  'Identificador do clique gerado pela Meta. Chega só na primeira mensagem e é o que permite devolver a conversão via CAPI.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.ad_referrals enable row level security;

drop policy if exists ad_referrals_select_own on public.ad_referrals;
create policy ad_referrals_select_own on public.ad_referrals
  for select using (auth.uid() = user_id);

-- Escrita é só do webhook (service_role, que ignora RLS). Sem policy de insert
-- de propósito: origem de lead não é algo que o lojista digita.
