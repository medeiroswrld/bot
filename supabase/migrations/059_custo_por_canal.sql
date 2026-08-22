-- 059 — separa o custo por canal (WhatsApp / Instagram)
--
-- Até aqui o custo era um número só por loja. Com o Instagram em produção isso
-- deixou de responder a pergunta que importa: o canal novo está se pagando?
--
-- O `llm_usage` não guarda o canal — guarda `conversation_id`. O canal mora em
-- `conversations.channel` (migration 037). Então a separação sai de um join, sem
-- coluna nova e sem reprocessar nada: o histórico inteiro já fica separado.
--
-- Conversa sem canal (anterior à 037) conta como whatsapp, que é o que ela era.
--
-- Ambas as funções são recriadas por inteiro de propósito. O banco deste projeto
-- já esteve fora de sincronia com o repo mais de uma vez; uma definição completa
-- vale independentemente de qual versão estava aplicada antes.

-- ── admin_metricas ───────────────────────────────────────────────────────────
-- A assinatura muda (4 colunas novas), e Postgres não deixa trocar o `returns
-- table` num replace. Por isso o drop.
drop function if exists public.admin_metricas(timestamptz);

create or replace function public.admin_metricas(p_desde timestamptz)
returns table (
  user_id             uuid,
  email               text,
  empresa             text,
  criado_em           timestamptz,
  conversas_bot       bigint,
  respostas_bot       bigint,
  tokens_entrada      bigint,
  tokens_saida        bigint,
  tokens_cache_w      bigint,
  tokens_cache_r      bigint,
  tokens_total        bigint,
  chamadas_outras     bigint,
  custo_total_usd     numeric,
  custo_medio_usd     numeric,
  custo_p90_usd       numeric,
  custo_whatsapp_usd  numeric,
  custo_instagram_usd numeric,
  conversas_instagram bigint,
  instagram_ativo     boolean,
  ultima_atividade    timestamptz,
  whatsapp_ativo      boolean,
  suspenso            boolean,
  suspenso_em         timestamptz,
  bot_enabled         boolean,
  billing_day         smallint,
  billing_amount      numeric,
  pago_mes_atual      boolean,
  pago_em             timestamptz
)
language sql
security definer
set search_path = ''
as $$
  with por_conversa as (
    -- Preço vem de model_pricing, por modelo. Escrita e leitura de cache entram
    -- separadas: a leitura custa um décimo da entrada, e este bot usa cache
    -- pesado — tratar tudo como entrada multiplicaria a conta.
    select u.user_id,
           u.conversation_id,
           coalesce(max(cv.channel), 'whatsapp') as canal,
           sum(public.custo_chamada(u.model, u.input_tokens, u.output_tokens,
                                    u.cache_creation_input_tokens, u.cache_read_input_tokens)) as custo
      from public.llm_usage u
      left join public.conversations cv on cv.id = u.conversation_id
     where u.created_at >= p_desde
       and u.conversation_id is not null
     group by u.user_id, u.conversation_id
  ),
  consumo as (
    select c.user_id,
           count(*)                                                                  as conversas_bot,
           round(sum(c.custo)::numeric, 4)                                           as custo_total_usd,
           round(avg(c.custo)::numeric, 4)                                           as custo_medio_usd,
           round((percentile_cont(0.9) within group (order by c.custo))::numeric, 4) as custo_p90_usd,
           round(coalesce(sum(c.custo) filter (where c.canal = 'whatsapp'), 0)::numeric, 4)  as custo_whatsapp_usd,
           round(coalesce(sum(c.custo) filter (where c.canal = 'instagram'), 0)::numeric, 4) as custo_instagram_usd,
           count(*) filter (where c.canal = 'instagram')                             as conversas_instagram
      from por_conversa c
     group by c.user_id
  ),
  tokens as (
    select u.user_id,
           count(*) filter (where coalesce(u.model, '') like 'claude%')     as chamadas,
           count(*) filter (where coalesce(u.model, '') not like 'claude%') as outras,
           sum(coalesce(u.input_tokens, 0))::bigint                         as t_in,
           sum(coalesce(u.output_tokens, 0))::bigint                        as t_out,
           sum(coalesce(u.cache_creation_input_tokens, 0))::bigint          as t_cw,
           sum(coalesce(u.cache_read_input_tokens, 0))::bigint              as t_cr,
           max(u.created_at)                                                as ultima
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
         coalesce(tk.outras, 0),
         coalesce(co.custo_total_usd, 0),
         coalesce(co.custo_medio_usd, 0),
         coalesce(co.custo_p90_usd, 0),
         coalesce(co.custo_whatsapp_usd, 0),
         coalesce(co.custo_instagram_usd, 0),
         coalesce(co.conversas_instagram, 0),
         (cs.ig_user_id is not null),
         tk.ultima,
         (cs.whatsapp_phone_number_id is not null),
         coalesce(cs.suspenso, false),
         cs.suspenso_em,
         coalesce(cs.bot_enabled, true),
         cs.billing_day,
         cs.billing_amount,
         (pag.pago_em is not null),
         pag.pago_em
    from public.company_settings cs
    left join auth.users au on au.id = cs.user_id
    left join consumo co    on co.user_id = cs.user_id
    left join tokens tk     on tk.user_id = cs.user_id
    left join pag           on pag.user_id = cs.user_id
   order by coalesce(co.custo_total_usd, 0) desc, au.created_at desc;
$$;

revoke all on function public.admin_metricas(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_metricas(timestamptz) to service_role;


-- ── admin_detalhe_loja ───────────────────────────────────────────────────────
-- Ganha a chave `canais`. Devolve json, então a assinatura não muda.
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
           sum(public.custo_chamada(u.model, u.input_tokens, u.output_tokens,
                                    u.cache_creation_input_tokens, u.cache_read_input_tokens)) as custo
      from public.llm_usage u
     where u.user_id = p_user_id
       and u.created_at >= p_desde
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
  canais as (
    -- Quanto cada canal custou e quantas conversas trouxe. É o que responde se
    -- o Instagram se paga: custo por conversa lado a lado com o WhatsApp.
    select json_agg(json_build_object(
             'canal',     x.canal,
             'conversas', x.conversas,
             'custo_usd', round(x.custo::numeric, 4)
           ) order by x.custo desc) as j
      from (
        select coalesce(cv.channel, 'whatsapp')  as canal,
               count(distinct u.conversation_id) as conversas,
               coalesce(sum(public.custo_chamada(u.model, u.input_tokens, u.output_tokens,
                                    u.cache_creation_input_tokens, u.cache_read_input_tokens)), 0) as custo
          from public.llm_usage u
          left join public.conversations cv on cv.id = u.conversation_id
         where u.user_id = p_user_id
           and u.created_at >= p_desde
           and u.conversation_id is not null
         group by 1
      ) x
  ),
  tokens as (
    select coalesce(sum(coalesce(u.input_tokens, 0)), 0)::bigint                as t_in,
           coalesce(sum(coalesce(u.output_tokens, 0)), 0)::bigint               as t_out,
           coalesce(sum(coalesce(u.cache_creation_input_tokens, 0)), 0)::bigint as t_cw,
           coalesce(sum(coalesce(u.cache_read_input_tokens, 0)), 0)::bigint     as t_cr
      from public.llm_usage u
     where u.user_id = p_user_id
       and u.created_at >= p_desde
  ),
  janelas as (
    -- 7/14/21/30 dias na MESMA consulta. Quatro chamadas separadas dariam
    -- quatro varreduras do llm_usage pra montar uma tabelinha.
    -- O join e por janela: a linha de 30 dias inclui a de 7, de proposito —
    -- sao acumulados, nao fatias exclusivas.
    select json_agg(json_build_object(
             'dias',      x.dias,
             'conversas', x.conversas,
             'por_dia',   round((x.conversas::numeric / x.dias), 1),
             'custo_usd', round(x.custo::numeric, 4)
           ) order by x.dias) as j
      from (
        select j.dias,
               count(distinct u.conversation_id) as conversas,
               coalesce(sum(public.custo_chamada(u.model, u.input_tokens, u.output_tokens,
                                    u.cache_creation_input_tokens, u.cache_read_input_tokens)), 0) as custo
          from (values (7), (14), (21), (30)) as j(dias)
          left join public.llm_usage u
            on u.user_id = p_user_id
               and u.conversation_id is not null
           and u.created_at >= now() - (j.dias || ' days')::interval
         group by j.dias
      ) x
  ),
  camp as (
    -- A propria tabela ja mantem os contadores (sent/delivered/read), entao nao
    -- ha por que varrer campaign_sends: seria join grande pra chegar no mesmo
    -- numero.
    select json_agg(x order by x.criada desc) as j
      from (
        select c.name                          as nome,
               c.status,
               c.created_at                    as criada,
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
    'canais',  coalesce((select j from canais), '[]'::json),
    'tokens',  (select json_build_object('entrada', t_in, 'saida', t_out,
                                         'cache_w', t_cw, 'cache_r', t_cr) from tokens),
    'janelas',   coalesce((select j from janelas), '[]'::json),
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
