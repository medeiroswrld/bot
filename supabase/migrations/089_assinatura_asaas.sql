-- 089 — assinatura paga pelo Asaas
--
-- Hoje a cobrança é manual: o administrador marca "pago" no painel e `suspenso`
-- desliga o bot. Funciona com dois clientes; não funciona com vinte. Esta
-- migration prepara o terreno para o pagamento no cartão decidir isso sozinho.
--
-- ── Por que o cartão NÃO passa pelo nosso servidor ──────────────────────────
--
-- O Asaas oferece dois caminhos: a API de tokenização, em que o número do
-- cartão vai do navegador pro nosso backend e de lá pra eles, e o Checkout
-- hospedado, em que o cliente digita o cartão numa página do próprio Asaas.
--
-- Escolhemos o segundo. O primeiro coloca o Amply dentro do escopo PCI-DSS —
-- dado de cartão trafegando na nossa infraestrutura, com a responsabilidade que
-- vem junto se vazar — em troca de o cliente não sair da nossa tela. É um ganho
-- cosmético por um risco real. Por isso aqui só existem IDs e status: nenhuma
-- coluna deste arquivo guarda dado de cartão, e nenhuma deve guardar.
--
-- ── A armadilha que esta migration desarma ──────────────────────────────────
--
-- No dia em que o portão ligar, quem não tiver assinatura é suspenso. A DSC e a
-- Leandrinho pagam por fora e não têm assinatura nenhuma no Asaas — sem a
-- isenção abaixo, os dois clientes pagantes seriam cortados pelo sistema no
-- mesmo instante. Já derrubamos produção duas vezes por ordem de migration;
-- desta vez a proteção entra ANTES da regra que a torna necessária.

-- ── 1. Colunas ──────────────────────────────────────────────────────────────

alter table public.company_settings
  add column if not exists asaas_customer_id       text,
  add column if not exists asaas_subscription_id   text,
  add column if not exists assinatura_status       text not null default 'sem_assinatura',
  add column if not exists assinatura_atualizada_em timestamptz,
  add column if not exists proximo_vencimento      date,
  add column if not exists ultimo_pagamento_em     timestamptz;

comment on column public.company_settings.assinatura_status is
  'sem_assinatura | ativa | atrasada | cancelada | isento. Quem libera o acesso é ativa e isento.';

comment on column public.company_settings.asaas_customer_id is
  'ID do cliente no Asaas. Nunca guardamos dado de cartão — o Checkout hospedado cuida disso.';

comment on column public.company_settings.proximo_vencimento is
  'Próxima cobrança, como o Asaas informou. Serve pra avisar o lojista antes de cortar, não pra decidir corte.';

-- Status livre em coluna de texto vira erro de digitação silencioso: alguém
-- grava 'ativo' em vez de 'ativa' e a conta some do portão sem ninguém notar.
alter table public.company_settings drop constraint if exists company_settings_assinatura_status_check;
alter table public.company_settings add constraint company_settings_assinatura_status_check
  check (assinatura_status in ('sem_assinatura', 'ativa', 'atrasada', 'cancelada', 'isento'));

-- ── 2. Quem já é cliente não paga pelo cartão ───────────────────────────────
--
-- Toda conta que existe HOJE é anterior à cobrança automática. Marcar por nome
-- de loja seria frágil (há três variações de "DSC Seminovos" no banco); a regra
-- correta é temporal: quem já estava aqui, fica isento.
update public.company_settings
   set assinatura_status = 'isento',
       assinatura_atualizada_em = now()
 where assinatura_status = 'sem_assinatura';

-- ── 3. Idempotência do webhook ──────────────────────────────────────────────
--
-- O Asaas reenvia evento quando não recebe 200 — comportamento correto dele, e
-- que sem trava vira pagamento contado duas vezes. Mesmo padrão já usado na
-- fila do CAPI e na deduplicação por `wa_message_id` do WhatsApp.
create table if not exists public.asaas_eventos (
  id            text primary key,          -- o `id` do evento no Asaas
  tipo          text not null,
  user_id       uuid references auth.users(id) on delete set null,
  payment_id    text,
  subscription_id text,
  recebido_em   timestamptz not null default now(),
  payload       jsonb
);

comment on table public.asaas_eventos is
  'Eventos recebidos do Asaas. A chave primária é o id do evento: reenvio não processa de novo.';

create index if not exists asaas_eventos_recebido_idx on public.asaas_eventos (recebido_em desc);

-- Só o service_role escreve aqui (a edge function do webhook). Sem policy de
-- leitura: nenhum lojista precisa ver isso, e o payload traz dado de cobrança.
alter table public.asaas_eventos enable row level security;

-- ── 4. O lojista não se marca como pago ─────────────────────────────────────
--
-- A RLS do company_settings é por LINHA: a política abre a linha inteira pro
-- dono. Sem esta trava, um `update` com `assinatura_status: 'ativa'` pela API
-- daria acesso vitalício de graça. Mesma lição da migration 070 — a política
-- abre a linha, o trigger protege as colunas.
create or replace function public.protege_campos_do_plano()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  papel text := coalesce(
    current_setting('request.jwt.claims', true)::json ->> 'role',
    ''
  );
begin
  if papel not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.bot_contratado is distinct from old.bot_contratado then
    raise exception 'O plano é definido pelo administrador do sistema.';
  end if;

  if new.disparos_contratado is distinct from old.disparos_contratado then
    raise exception 'O plano é definido pelo administrador do sistema.';
  end if;

  if new.suspenso is distinct from old.suspenso then
    raise exception 'A suspensão é definida pelo administrador do sistema.';
  end if;

  if new.capi_dataset_id is distinct from old.capi_dataset_id
     or new.capi_enabled is distinct from old.capi_enabled then
    raise exception 'A integração de anúncios é definida pelo administrador do sistema.';
  end if;

  -- Novo: tudo que decide se a conta está paga.
  if new.assinatura_status    is distinct from old.assinatura_status
     or new.asaas_customer_id     is distinct from old.asaas_customer_id
     or new.asaas_subscription_id is distinct from old.asaas_subscription_id
     or new.proximo_vencimento    is distinct from old.proximo_vencimento
     or new.ultimo_pagamento_em   is distinct from old.ultimo_pagamento_em then
    raise exception 'A assinatura é definida pelo pagamento, não pelo aplicativo.';
  end if;

  return new;
end;
$$;
