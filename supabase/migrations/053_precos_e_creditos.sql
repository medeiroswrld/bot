-- 053 — Preço por modelo em tabela + saldo de créditos por plataforma
--
-- Dois problemas resolvidos.
--
-- 1. O preço do Claude estava escrito DENTRO da função de custo. Reajuste da
--    Anthropic, troca de modelo ou uso de outro provedor tornavam a conta
--    errada em silêncio — e transcrição de áudio (OpenAI) simplesmente não
--    entrava no custo.
--
-- 2. Não há API pública confiável de saldo nem na Anthropic nem na OpenAI (o
--    endpoint de créditos da OpenAI foi descontinuado para chave comum). Então
--    o saldo é registrado à mão e o painel desconta o consumo a partir da data
--    do registro, estimando quanto resta e por quantos dias.

-- ── Preços por modelo, em USD por 1 MILHÃO de tokens ─────────────────────────
create table if not exists public.model_pricing (
  -- Prefixo, não nome exato: 'claude-sonnet-4-6' casa com qualquer sufixo de
  -- versão que a API venha a usar. Na hora do cálculo vence o prefixo MAIS
  -- LONGO que casar, então dá pra ter regra geral e exceção.
  prefixo         text primary key,
  plataforma      text not null,
  entrada_usd     numeric(10,4) not null default 0,
  saida_usd       numeric(10,4) not null default 0,
  cache_write_usd numeric(10,4) not null default 0,
  cache_read_usd  numeric(10,4) not null default 0,
  atualizado_em   timestamptz not null default now()
);

-- Preços Claude conferidos na documentação oficial em 2026-08-20.
-- Cache: escrita 1,25x da entrada, leitura 0,1x (TTL padrão de 5 min).
insert into public.model_pricing (prefixo, plataforma, entrada_usd, saida_usd, cache_write_usd, cache_read_usd)
values ('claude-sonnet-4-6', 'anthropic', 3.00, 15.00, 3.75, 0.30),
       ('claude',            'anthropic', 3.00, 15.00, 3.75, 0.30)
on conflict (prefixo) do nothing;

-- Modelos OpenAI ficam com preço ZERO até serem preenchidos: melhor aparecer
-- "sem preço cadastrado" no painel do que somar um número inventado à conta.
insert into public.model_pricing (prefixo, plataforma, entrada_usd, saida_usd, cache_write_usd, cache_read_usd)
values ('gpt',     'openai', 0, 0, 0, 0),
       ('whisper', 'openai', 0, 0, 0, 0)
on conflict (prefixo) do nothing;

alter table public.model_pricing enable row level security;
-- Sem policy: só a edge function do administrador, via service_role.

-- ── Saldo de créditos por plataforma ─────────────────────────────────────────
create table if not exists public.platform_credits (
  plataforma    text primary key,
  saldo_usd     numeric(12,2) not null default 0,
  -- Momento em que esse saldo foi conferido no site do provedor. É a partir
  -- daqui que o consumo é descontado.
  registrado_em timestamptz not null default now(),
  observacao    text
);

insert into public.platform_credits (plataforma, saldo_usd)
values ('anthropic', 0), ('openai', 0)
on conflict (plataforma) do nothing;

alter table public.platform_credits enable row level security;

-- ── Custo de uma chamada, usando a tabela de preços ──────────────────────────
-- Prefixo mais longo vence: 'claude-sonnet-4-6' ganha de 'claude'.
create or replace function public.custo_chamada(
  p_model text, p_in int, p_out int, p_cw int, p_cr int
) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select coalesce(p_in, 0) * mp.entrada_usd     / 1000000
         + coalesce(p_out, 0) * mp.saida_usd      / 1000000
         + coalesce(p_cw, 0) * mp.cache_write_usd / 1000000
         + coalesce(p_cr, 0) * mp.cache_read_usd  / 1000000
      from public.model_pricing mp
     where coalesce(p_model, '') like mp.prefixo || '%'
     order by length(mp.prefixo) desc
     limit 1
  ), 0);
$$;

revoke all on function public.custo_chamada(text, int, int, int, int) from public, anon, authenticated;
grant execute on function public.custo_chamada(text, int, int, int, int) to service_role;

-- ── Saldo estimado: registro menos consumo desde a data do registro ──────────
create or replace function public.admin_creditos()
returns json
language sql
security definer
set search_path = ''
as $$
  select coalesce(json_agg(json_build_object(
           'plataforma',    c.plataforma,
           'saldo_usd',     c.saldo_usd,
           'registrado_em', c.registrado_em,
           'gasto_desde',   round(g.gasto, 4),
           'saldo_atual',   round((c.saldo_usd - g.gasto)::numeric, 4),
           -- Media diaria do periodo desde o registro. Com menos de meio dia
           -- corrido a media explodiria, entao o piso e 0,5.
           'por_dia',       round((g.gasto / greatest(0.5, extract(epoch from (now() - c.registrado_em)) / 86400))::numeric, 4),
           'dias_restantes', case
             when g.gasto <= 0 then null
             else floor((c.saldo_usd - g.gasto) /
                        greatest(0.0001, g.gasto / greatest(0.5, extract(epoch from (now() - c.registrado_em)) / 86400)))
           end
         ) order by c.plataforma), '[]'::json)
    from public.platform_credits c
    cross join lateral (
      select coalesce(sum(public.custo_chamada(
               u.model, u.input_tokens, u.output_tokens,
               u.cache_creation_input_tokens, u.cache_read_input_tokens)), 0) as gasto
        from public.llm_usage u
        join public.model_pricing mp
          on coalesce(u.model, '') like mp.prefixo || '%'
         and mp.plataforma = c.plataforma
       where u.created_at >= c.registrado_em
    ) g;
$$;

revoke all on function public.admin_creditos() from public, anon, authenticated;
grant execute on function public.admin_creditos() to service_role;
