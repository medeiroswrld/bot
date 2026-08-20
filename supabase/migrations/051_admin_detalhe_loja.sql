-- 051 — Detalhe de uma loja para o painel do administrador
--
-- A visão em tabela responde "quanto no total"; esta responde "como está indo
-- ESTA loja". Retorna json em vez de returns table porque o payload é misto:
-- série diária + contadores + campanhas, cada um com formato próprio. Três
-- funções separadas dariam três round-trips pra montar uma tela só.
--
-- Não retorna NADA de conteúdo de conversa — nem texto, nem telefone de cliente
-- final. O administrador precisa de volume e custo, não do que foi conversado.
create or replace function public.admin_detalhe_loja(p_user_id uuid, p_desde timestamptz)
returns json
language sql
security definer
set search_path = ''
as $$
  with dias as (
    -- Série contínua: dia sem movimento precisa aparecer como zero, senão o
    -- gráfico "pula" o buraco e a loja parada parece ativa.
    select generate_series(
             date_trunc('day', p_desde),
             date_trunc('day', now()),
             interval '1 day'
           )::date as dia
  ),
  uso as (
    select date_trunc('day', u.created_at)::date as dia,
           count(distinct u.conversation_id)     as conversas,
           count(*)                              as chamadas,
           sum(
             coalesce(u.input_tokens, 0)                * 3.00  / 1000000
           + coalesce(u.output_tokens, 0)               * 15.00 / 1000000
           + coalesce(u.cache_creation_input_tokens, 0) * 3.75  / 1000000
           + coalesce(u.cache_read_input_tokens, 0)     * 0.30  / 1000000
           ) as custo
      from public.llm_usage u
     where u.user_id = p_user_id
       and u.created_at >= p_desde
       and coalesce(u.model, '') like 'claude%'
     group by 1
  ),
  serie as (
    select json_agg(json_build_object(
             'dia',       d.dia,
             'conversas', coalesce(u.conversas, 0),
             'chamadas',  coalesce(u.chamadas, 0),
             'custo_usd', round(coalesce(u.custo, 0)::numeric, 4)
           ) order by d.dia) as j
      from dias d
      left join uso u on u.dia = d.dia
  ),
  tokens as (
    select coalesce(sum(coalesce(u.input_tokens, 0)), 0)::bigint                as t_in,
           coalesce(sum(coalesce(u.output_tokens, 0)), 0)::bigint               as t_out,
           coalesce(sum(coalesce(u.cache_creation_input_tokens, 0)), 0)::bigint as t_cw,
           coalesce(sum(coalesce(u.cache_read_input_tokens, 0)), 0)::bigint     as t_cr
      from public.llm_usage u
     where u.user_id = p_user_id
       and u.created_at >= p_desde
       and coalesce(u.model, '') like 'claude%'
  ),
  camp as (
    -- A propria tabela ja mantem os contadores (sent/delivered/read), entao nao
    -- ha por que varrer campaign_sends: seria join grande pra chegar no mesmo
    -- numero.
    select json_agg(x order by x.criada desc) as j
      from (
        select c.name                        as nome,
               c.status,
               c.created_at                  as criada,
               coalesce(c.recipients_count, 0) as destinatarios,
               coalesce(c.sent_count, 0)       as enviados,
               coalesce(c.delivered_count, 0)  as entregues,
               coalesce(c.read_count, 0)       as lidas
          from public.campaigns c
         where c.user_id = p_user_id
           and c.created_at >= p_desde
         order by c.created_at desc
         limit 20
      ) x
  ),
  tpl as (
    select json_agg(json_build_object('status', t.status, 'n', t.n)) as j
      from (
        select status, count(*) as n
          from public.message_templates
         where user_id = p_user_id
         group by status
      ) t
  )
  select json_build_object(
    'serie',   coalesce((select j from serie), '[]'::json),
    'tokens',  (select json_build_object('entrada', t_in, 'saida', t_out,
                                         'cache_w', t_cw, 'cache_r', t_cr) from tokens),
    'campanhas', coalesce((select j from camp), '[]'::json),
    'templates', coalesce((select j from tpl), '[]'::json),
    'totais', json_build_object(
      'leads',       (select count(*) from public.leads         where user_id = p_user_id),
      'carros',      (select count(*) from public.cars          where user_id = p_user_id),
      'conversas',   (select count(*) from public.conversations where user_id = p_user_id),
      'interesses',  (select count(*) from public.vehicle_interests where user_id = p_user_id),
      'leads_novos', (select count(*) from public.leads where user_id = p_user_id and created_at >= p_desde)
    )
  );
$$;

revoke all on function public.admin_detalhe_loja(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_detalhe_loja(uuid, timestamptz) to service_role;
