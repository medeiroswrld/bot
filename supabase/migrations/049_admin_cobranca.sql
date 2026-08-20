-- 049 — Cobrança manual e métricas completas para o painel do administrador
--
-- Substitui a admin_metricas da 048, que só listava quem teve conversa no
-- período. Loja cadastrada e PARADA é justamente a que precisa aparecer — é
-- cliente que não está usando e provavelmente vai cancelar.

-- ── 1. Plano de cada loja ────────────────────────────────────────────────────
-- Dia fixo do mês, não data cheia: a cobrança se repete todo mês no mesmo dia.
alter table public.company_settings
  add column if not exists billing_day    smallint,
  add column if not exists billing_amount numeric(10,2);

comment on column public.company_settings.billing_day is
  'Dia do mes em que a loja paga (1-31). NULL = sem cobranca configurada.';
comment on column public.company_settings.billing_amount is
  'Valor mensal em R$.';

-- ── 2. Pagamentos lançados à mão ─────────────────────────────────────────────
-- Uma linha por loja e competência. A ausência de linha é o que significa
-- "pendente" — assim não é preciso gerar cobrança antecipada pra todo mundo
-- todo mês, nem manter um cron só pra isso.
create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Sempre o dia 1 do mês de referência, pra competência ser comparável.
  competencia date not null,
  valor       numeric(10,2),
  pago_em     timestamptz,
  observacao  text,
  created_at  timestamptz not null default now(),
  unique (user_id, competencia)
);

create index if not exists idx_payments_user on public.payments (user_id, competencia desc);

alter table public.payments enable row level security;
-- Sem policy: ninguém alcança pelo PostgREST. Só a edge function do
-- administrador, com service_role, que ignora RLS.

-- ── 3. Métricas: TODAS as lojas, com ou sem uso ──────────────────────────────
drop function if exists public.admin_metricas(timestamptz);

create or replace function public.admin_metricas(p_desde timestamptz)
returns table (
  user_id           uuid,
  email             text,
  empresa           text,
  criado_em         timestamptz,
  -- consumo
  conversas_bot     bigint,
  respostas_bot     bigint,
  tokens_entrada    bigint,
  tokens_saida      bigint,
  tokens_cache_w    bigint,
  tokens_cache_r    bigint,
  tokens_total      bigint,
  custo_total_usd   numeric,
  custo_medio_usd   numeric,
  custo_p90_usd     numeric,
  ultima_atividade  timestamptz,
  -- operação
  whatsapp_ativo    boolean,
  -- cobrança
  billing_day       smallint,
  billing_amount    numeric,
  pago_mes_atual    boolean,
  pago_em           timestamptz
)
language sql
security definer
set search_path = ''
as $$
  with por_conversa as (
    select u.user_id,
           u.conversation_id,
           sum(
             coalesce(u.input_tokens, 0)                * 3.00  / 1000000
           + coalesce(u.output_tokens, 0)               * 15.00 / 1000000
           + coalesce(u.cache_creation_input_tokens, 0) * 3.75  / 1000000
           + coalesce(u.cache_read_input_tokens, 0)     * 0.30  / 1000000
           ) as custo
      from public.llm_usage u
     where u.created_at >= p_desde
       and u.conversation_id is not null
     group by u.user_id, u.conversation_id
  ),
  consumo as (
    select c.user_id,
           count(*)                                                           as conversas_bot,
           round(sum(c.custo)::numeric, 4)                                    as custo_total_usd,
           round(avg(c.custo)::numeric, 4)                                    as custo_medio_usd,
           round((percentile_cont(0.9) within group (order by c.custo))::numeric, 4) as custo_p90_usd
      from por_conversa c
     group by c.user_id
  ),
  tokens as (
    select u.user_id,
           count(*)                                            as chamadas,
           sum(coalesce(u.input_tokens, 0))::bigint            as t_in,
           sum(coalesce(u.output_tokens, 0))::bigint           as t_out,
           sum(coalesce(u.cache_creation_input_tokens, 0))::bigint as t_cw,
           sum(coalesce(u.cache_read_input_tokens, 0))::bigint     as t_cr,
           max(u.created_at)                                   as ultima
      from public.llm_usage u
     where u.created_at >= p_desde
     group by u.user_id
  ),
  pag as (
    select p.user_id, p.pago_em
      from public.payments p
     where p.competencia = date_trunc('month', now())::date
  )
  select cs.user_id,
         au.email::text,
         cs.company_name::text,
         au.created_at,
         coalesce(co.conversas_bot, 0),
         coalesce(tk.chamadas, 0),
         coalesce(tk.t_in, 0),
         coalesce(tk.t_out, 0),
         coalesce(tk.t_cw, 0),
         coalesce(tk.t_cr, 0),
         coalesce(tk.t_in, 0) + coalesce(tk.t_out, 0) + coalesce(tk.t_cw, 0) + coalesce(tk.t_cr, 0),
         coalesce(co.custo_total_usd, 0),
         coalesce(co.custo_medio_usd, 0),
         coalesce(co.custo_p90_usd, 0),
         tk.ultima,
         (cs.whatsapp_phone_number_id is not null),
         cs.billing_day,
         cs.billing_amount,
         (pag.pago_em is not null),
         pag.pago_em
    -- LEFT a partir de company_settings: loja sem nenhuma conversa aparece
    -- zerada em vez de sumir. Cliente parado e o que mais interessa ver.
    from public.company_settings cs
    left join auth.users au on au.id = cs.user_id
    left join consumo co    on co.user_id = cs.user_id
    left join tokens tk     on tk.user_id = cs.user_id
    left join pag           on pag.user_id = cs.user_id
   order by coalesce(co.custo_total_usd, 0) desc, au.created_at desc;
$$;

revoke all on function public.admin_metricas(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_metricas(timestamptz) to service_role;

-- ── 4. Marcar/desmarcar pagamento ────────────────────────────────────────────
create or replace function public.admin_marcar_pagamento(
  p_user_id uuid,
  p_competencia date,
  p_pago boolean,
  p_valor numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_pago then
    insert into public.payments (user_id, competencia, valor, pago_em)
    values (p_user_id, date_trunc('month', p_competencia)::date, p_valor, now())
    on conflict (user_id, competencia)
    do update set pago_em = now(), valor = coalesce(excluded.valor, public.payments.valor);
  else
    -- Desmarcar apaga a linha: ausencia de linha E o estado "pendente", entao
    -- deixar pago_em nulo criaria dois jeitos de dizer a mesma coisa.
    delete from public.payments
     where user_id = p_user_id
       and competencia = date_trunc('month', p_competencia)::date;
  end if;
end;
$$;

revoke all on function public.admin_marcar_pagamento(uuid, date, boolean, numeric) from public, anon, authenticated;
grant execute on function public.admin_marcar_pagamento(uuid, date, boolean, numeric) to service_role;
