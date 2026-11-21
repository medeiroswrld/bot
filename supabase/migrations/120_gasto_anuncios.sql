-- ============================================================================
-- 120 — Gasto por anúncio (Meta Marketing API)
-- ============================================================================
--
-- O que faltava pra atribuição fechar. Em 21/11 a `anuncio_desempenho` já
-- sabia quantos leads e quanto faturamento cada anúncio trouxe, mas **nada no
-- sistema sabia quanto cada anúncio CUSTOU** — isso vivia só no gerenciador da
-- Meta. Sem o custo não existe CPL, custo por venda nem ROAS, que é
-- exatamente o que se espera de uma ferramenta de atribuição.
--
-- O gasto é importado por DIA e por ANÚNCIO (`time_increment=1`,
-- `level=ad`). Guardar o total acumulado seria menor, mas a Meta **revisa o
-- gasto retroativamente** (cliques inválidos saem depois), e um total não
-- deixa recalcular. Com linha por dia, reimportar a janela corrige sozinho.
--
-- Idempotente: pode ser reexecutada sem erro.
-- ============================================================================

-- ── Conta de anúncios da loja ───────────────────────────────────────────────
--
-- Descoberta sozinha na primeira importação (a partir do `source_id` de um
-- clique que já temos) e guardada aqui. Fica como coluna editável porque uma
-- loja pode ter mais de uma conta e a descoberta escolhe a do último anúncio
-- que trouxe lead — certa quase sempre, não sempre.
alter table public.company_settings
  add column if not exists meta_ad_account_id text;

comment on column public.company_settings.meta_ad_account_id is
  'ID da conta de anúncios da Meta (só os dígitos, sem o prefixo act_). Vazio = descobrir na próxima importação.';

-- ── Gasto diário por anúncio ────────────────────────────────────────────────
create table if not exists public.ad_insights (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  ad_id         text        not null,
  dia           date        not null,
  ad_name       text,
  campaign_name text,
  spend         numeric     not null default 0,
  impressions   bigint      not null default 0,
  clicks        bigint      not null default 0,
  atualizado_em timestamptz not null default now()
);

-- A chave é (loja, anúncio, dia): reimportar a janela ATUALIZA a linha em vez
-- de duplicar o gasto. É o que torna a correção retroativa da Meta inofensiva.
create unique index if not exists ad_insights_unico
  on public.ad_insights (user_id, ad_id, dia);

create index if not exists ad_insights_loja_dia
  on public.ad_insights (user_id, dia desc);

comment on table public.ad_insights is
  'Gasto diário por anúncio, importado da Marketing API. Uma linha por (loja, anúncio, dia) — reimportar corrige em vez de somar.';

alter table public.ad_insights enable row level security;

drop policy if exists ad_insights_select_own   on public.ad_insights;
drop policy if exists ad_insights_service_role on public.ad_insights;

create policy ad_insights_select_own on public.ad_insights
  for select using (auth.uid() = user_id);
create policy ad_insights_service_role on public.ad_insights
  for all    using (auth.role() = 'service_role');

-- ── Token de leitura de anúncios ────────────────────────────────────────────
--
-- Mesmo padrão do token da CAPI (073) e do WhatsApp (015): nunca em coluna,
-- nunca no front. Opcional por loja — ausente, a function cai no token global
-- da Amply (env META_ADS_TOKEN), que é o caso normal enquanto quem gerencia o
-- anúncio é ela.
--
-- Precisa do escopo `ads_read`. O token do WhatsApp NÃO serve: testado em
-- 21/11 contra um ad_id real e a Graph devolveu code 100 / subcode 33.
create or replace function public.set_ads_token(p_user_id uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := 'ads_token_' || p_user_id::text;
  v_id   uuid;
begin
  select id into v_id from vault.secrets where name = v_nome;
  if v_id is null then
    perform vault.create_secret(p_token, v_nome, 'Token de leitura de anuncios da loja ' || p_user_id::text);
  else
    perform vault.update_secret(v_id, p_token);
  end if;
end;
$$;

create or replace function public.get_ads_token(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  select ds.decrypted_secret into v_token
  from vault.decrypted_secrets ds
  where ds.name = 'ads_token_' || p_user_id::text;
  return v_token;
end;
$$;

revoke all on function public.set_ads_token(uuid, text) from public, anon, authenticated;
revoke all on function public.get_ads_token(uuid)       from public, anon, authenticated;
grant  execute on function public.set_ads_token(uuid, text) to service_role;
grant  execute on function public.get_ads_token(uuid)       to service_role;

-- ── A view ganha o lado do custo ────────────────────────────────────────────
--
-- O gasto entra por CTE e não por join direto no grupo: juntar antes do
-- group by multiplicaria o gasto pelo número de cliques do anúncio, e o
-- relatório mostraria custo inflado sem nenhum erro aparecer.
drop view if exists public.anuncio_desempenho;

create view public.anuncio_desempenho
with (security_invoker = true)
as
with base as (
  select
    r.user_id,
    r.source_id,
    min(r.source_type)                                        as source_type,
    min(r.headline)                                           as headline,
    count(distinct r.lead_id)                                 as leads,
    count(distinct r.lead_id) filter (where r.ctwa_clid is not null) as atribuiveis,
    count(distinct l.id) filter (
      where l.status in ('proposta', 'negociacao', 'vendido')
    )                                                         as qualificados,
    count(distinct l.id) filter (where l.status = 'vendido')  as vendas,
    coalesce(sum(c.sold_price) filter (where l.status = 'vendido'), 0) as faturamento,
    -- Lucro só soma carro com preço de compra preenchido. Tratar compra vazia
    -- como zero diria que o carro inteiro é lucro — número grande e falso.
    coalesce(sum(c.sold_price - c.purchase_price) filter (
      where l.status = 'vendido' and c.purchase_price is not null
    ), 0)                                                     as lucro,
    min(r.created_at)                                         as primeiro_clique,
    max(r.created_at)                                         as ultimo_clique
  from public.ad_referrals r
  left join public.leads l on l.id = r.lead_id
  left join public.cars  c on c.id = l.sold_car_id
  where r.source_id is not null
  group by r.user_id, r.source_id
),
gasto as (
  select user_id, ad_id,
         sum(spend)       as gasto,
         sum(impressions) as impressoes,
         sum(clicks)      as cliques,
         min(dia)         as primeiro_dia_gasto,
         max(dia)         as ultimo_dia_gasto
  from public.ad_insights
  group by user_id, ad_id
)
select
  b.user_id, b.source_id, b.source_type, b.headline,
  b.leads, b.atribuiveis, b.qualificados, b.vendas,
  b.faturamento, b.lucro,
  b.primeiro_clique, b.ultimo_clique,
  coalesce(g.gasto, 0)       as gasto,
  coalesce(g.impressoes, 0)  as impressoes,
  coalesce(g.cliques, 0)     as cliques,
  g.primeiro_dia_gasto,
  g.ultimo_dia_gasto,
  -- Os derivados são NULL (não zero) quando falta o ingrediente: zero aqui
  -- leria como "custou nada por lead", que é o oposto de "não sei o custo".
  case when g.gasto > 0 and b.leads  > 0 then round(g.gasto / b.leads,  2) end as custo_por_lead,
  case when g.gasto > 0 and b.vendas > 0 then round(g.gasto / b.vendas, 2) end as custo_por_venda,
  case when g.gasto > 0 then round(b.faturamento / g.gasto, 2) end             as roas,
  -- O número que interessa a uma loja de carro: o que sobrou do lucro do
  -- veículo depois de pagar o anúncio. ROAS sobre faturamento fica bonito
  -- demais quando o produto custa R$ 100 mil.
  case when g.gasto > 0 then round(b.lucro - g.gasto, 2) end                   as lucro_apos_anuncio
from base b
left join gasto g on g.user_id = b.user_id and g.ad_id = b.source_id;

comment on view public.anuncio_desempenho is
  'Desempenho por origem, agora com custo. source_type separa anúncio pago de publicação orgânica; atribuiveis diz quantos leads têm clique e portanto podem virar conversão na Meta; os derivados (CPL, custo por venda, ROAS) são NULL quando o gasto ainda não foi importado.';
