-- 091 — planos por número de conversas
--
-- Até aqui o preço era um número solto em `billing_amount`, combinado no olho.
-- Funciona com dois clientes e não funciona com vinte: ninguém lembra o que
-- prometeu para quem, e não há como dizer "você está perto do limite" porque
-- limite não existe.
--
-- ── A escada, e de onde vieram os números ───────────────────────────────────
--
-- Calibrada no uso REAL, não em chute. Nos 30 dias até 14/09/2026 a DSC fez
-- 218 conversas com o bot, a US$ 0,2299 cada (~R$ 1,24). O teste de sanidade do
-- desenho é que a DSC cai sozinha no Crescimento, a R$ 1.997 — quase exatamente
-- os R$ 2.000 que já eram cobrados dela por negociação. Quando a tabela
-- reproduz um preço fechado no olho, ela está ancorada na realidade.
--
--   CRM          sem bot          R$   800   custo de IA zero
--   Essencial    100 conversas    R$ 1.497   ~R$ 124 de IA   (92% de margem)
--   Crescimento  250 conversas    R$ 1.997   ~R$ 310         (84%)
--   Performance  500 conversas    R$ 2.497   ~R$ 620         (75%)
--   Personalizado  sem limite     negociado
--
-- ── O limite AVISA, não corta ───────────────────────────────────────────────
--
-- Estourar a faixa não desliga o bot. Cortar no meio de um atendimento faria o
-- lojista perder uma venda por causa do nosso plano, e é isso que ele lembraria
-- para sempre. O custo de deixar passar é ridículo: 50 conversas de cortesia
-- custam R$ 62 e compram uma conversa comercial tranquila.
--
-- Quem corta o bot continua sendo só falta de pagamento (migration 089) e
-- suspensão pelo administrador.

-- ── 1. A tabela de planos ───────────────────────────────────────────────────

create table if not exists public.planos (
  slug              text primary key,
  nome              text not null,
  -- null = sem limite. É o que separa "personalizado" dos demais.
  limite_conversas  int,
  -- Preço de tabela. O que vale na cobrança é `company_settings.billing_amount`,
  -- que pode divergir por negociação — aqui fica a referência.
  preco             numeric,
  inclui_bot        boolean not null default true,
  ordem             int not null default 0
);

comment on table public.planos is
  'Escada de planos por conversas/mes. O limite AVISA, nunca corta o bot.';

insert into public.planos (slug, nome, limite_conversas, preco, inclui_bot, ordem) values
  ('crm',           'CRM',            0,    800.00,  false, 1),
  ('essencial',     'Essencial',      100,  1497.00, true,  2),
  ('crescimento',   'Crescimento',    250,  1997.00, true,  3),
  ('performance',   'Performance',    500,  2497.00, true,  4),
  ('personalizado', 'Personalizado',  null, null,    true,  5)
on conflict (slug) do update set
  nome = excluded.nome,
  limite_conversas = excluded.limite_conversas,
  preco = excluded.preco,
  inclui_bot = excluded.inclui_bot,
  ordem = excluded.ordem;

-- Todo mundo pode ler a tabela de planos: ela é pública por natureza, e a tela
-- do lojista precisa mostrar o nome do plano dele.
alter table public.planos enable row level security;
drop policy if exists planos_leitura on public.planos;
create policy planos_leitura on public.planos for select to authenticated using (true);

-- ── 2. Qual plano cada loja tem ─────────────────────────────────────────────

alter table public.company_settings
  add column if not exists plano text references public.planos(slug);

comment on column public.company_settings.plano is
  'Plano contratado. Nulo = anterior aos planos; trata-se como personalizado, sem limite.';

-- Quem já é cliente entra como personalizado: eles foram negociados antes desta
-- tabela existir, e encaixá-los à força numa faixa mudaria o que foi combinado.
update public.company_settings
   set plano = 'personalizado'
 where plano is null;

-- ── 3. Quantas conversas a loja usou no mês ─────────────────────────────────
--
-- A contagem é de CONVERSA, não de mensagem: um cliente que troca quarenta
-- mensagens conta uma vez, e o mesmo cliente voltando no mesmo mês também conta
-- uma. É como o painel já media, e é a definição que precisa estar no contrato.
--
-- Mês civil, não ciclo de cobrança. "100 conversas por mês" é o que o lojista
-- entende; explicar que o mês dele começa no dia 7 é atrito à toa.
create or replace function public.conversas_do_mes(p_user_id uuid, p_ref date default current_date)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct u.conversation_id)::int
    from public.llm_usage u
   where u.user_id = p_user_id
     and u.created_at >= date_trunc('month', p_ref)
     and u.created_at <  date_trunc('month', p_ref) + interval '1 month';
$$;

/**
 * O consumo da PRÓPRIA loja, para a tela de assinatura.
 *
 * Existe como função em vez de consulta direta porque `llm_usage` guarda dado
 * de custo que o lojista não precisa ver. Ele vê quantas conversas usou e
 * quantas tem — não quanto cada uma custou.
 */
create or replace function public.meu_uso_do_mes()
returns table (usadas int, limite int, plano_nome text, plano_slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.conversas_do_mes(cs.user_id),
    p.limite_conversas,
    coalesce(p.nome, 'Personalizado'),
    coalesce(cs.plano, 'personalizado')
  from public.company_settings cs
  left join public.planos p on p.slug = cs.plano
  where cs.user_id = auth.uid();
$$;

grant execute on function public.meu_uso_do_mes() to authenticated;

-- ── 4. O lojista não escolhe o próprio plano ────────────────────────────────
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

  if new.plano is distinct from old.plano then
    raise exception 'O plano é definido pelo administrador do sistema.';
  end if;

  if new.suspenso is distinct from old.suspenso then
    raise exception 'A suspensão é definida pelo administrador do sistema.';
  end if;

  if new.capi_dataset_id is distinct from old.capi_dataset_id
     or new.capi_enabled is distinct from old.capi_enabled then
    raise exception 'A integração de anúncios é definida pelo administrador do sistema.';
  end if;

  if new.assinatura_status    is distinct from old.assinatura_status
     or new.asaas_customer_id     is distinct from old.asaas_customer_id
     or new.asaas_subscription_id is distinct from old.asaas_subscription_id
     or new.asaas_checkout_id     is distinct from old.asaas_checkout_id
     or new.proximo_vencimento    is distinct from old.proximo_vencimento
     or new.ultimo_pagamento_em   is distinct from old.ultimo_pagamento_em then
    raise exception 'A assinatura é definida pelo pagamento, não pelo aplicativo.';
  end if;

  return new;
end;
$$;
