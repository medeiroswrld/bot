-- 048 — Métricas por loja para o painel do administrador
--
-- Responde "quanto custa um lead". O llm_usage já grava, por chamada:
-- user_id, conversation_id, modelo e as quatro contagens de token. Faltava só
-- transformar isso em custo.
--
-- Preços Anthropic por 1M de tokens (claude-sonnet-4-6, conferidos 2026-08-20):
--   entrada $3,00 | saída $15,00 | escrita de cache $3,75 | leitura de cache $0,30
-- A leitura de cache custa 10% da entrada — por isso ela entra separada em vez
-- de somar tudo como "input", o que superestimaria o custo em várias vezes.
--
-- SECURITY DEFINER + revoke: quem chama é a edge function com service_role,
-- depois de conferir que o chamador é o administrador. Nenhum lojista alcança.
create or replace function public.admin_metricas(p_desde timestamptz)
returns table (
  user_id            uuid,
  email              text,
  empresa            text,
  conversas_bot      bigint,
  chamadas           bigint,
  custo_total_usd    numeric,
  custo_medio_usd    numeric,
  custo_p90_usd      numeric,
  ultima_atividade   timestamptz
)
language sql
security definer
set search_path = ''
as $$
  with por_conversa as (
    select u.user_id,
           u.conversation_id,
           count(*) as chamadas,
           sum(
             coalesce(u.input_tokens, 0)                * 3.00 / 1000000
           + coalesce(u.output_tokens, 0)               * 15.00 / 1000000
           + coalesce(u.cache_creation_input_tokens, 0) * 3.75 / 1000000
           + coalesce(u.cache_read_input_tokens, 0)     * 0.30 / 1000000
           ) as custo,
           max(u.created_at) as ultima
      from public.llm_usage u
     where u.created_at >= p_desde
       and u.conversation_id is not null
     group by u.user_id, u.conversation_id
  )
  select c.user_id,
         au.email::text,
         cs.company_name::text,
         count(*)                                                          as conversas_bot,
         sum(c.chamadas)                                                   as chamadas,
         round(sum(c.custo)::numeric, 4)                                   as custo_total_usd,
         round(avg(c.custo)::numeric, 4)                                   as custo_medio_usd,
         -- p90: a conversa cara e a que percorreu o funil inteiro. E a
         -- estimativa mais honesta de "custo de um lead completo" sem inventar
         -- juncao com agendamento.
         round((percentile_cont(0.9) within group (order by c.custo))::numeric, 4) as custo_p90_usd,
         max(c.ultima)                                                     as ultima_atividade
    from por_conversa c
    left join auth.users au            on au.id = c.user_id
    left join public.company_settings cs on cs.user_id = c.user_id
   group by c.user_id, au.email, cs.company_name
   order by 6 desc;
$$;

revoke all on function public.admin_metricas(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_metricas(timestamptz) to service_role;
