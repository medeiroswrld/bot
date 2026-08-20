-- 050 — Suspensão pelo administrador + custo calculado por modelo
--
-- Duas correções e um recurso novo.

-- ── 1. Suspensão ─────────────────────────────────────────────────────────────
-- Separada de bot_enabled DE PROPÓSITO: bot_enabled é do lojista, suspenso é do
-- administrador. Se fosse a mesma chave, o inadimplente se reativaria sozinho.
--
-- Suspenso NÃO descarta mensagem: ela continua sendo salva e a conversa vai pra
-- pendente. Apagar o phone_number_id (a alternativa) faria a mensagem sumir sem
-- registro — quem perderia seria o consumidor final, que não deve nada.
alter table public.company_settings
  add column if not exists suspenso        boolean not null default false,
  add column if not exists suspenso_em     timestamptz,
  add column if not exists suspenso_motivo text;

comment on column public.company_settings.suspenso is
  'Suspensao pelo administrador (inadimplencia etc). O lojista NAO controla isso. Bot para de responder; mensagens continuam sendo salvas.';

-- ── 2. Custo por modelo ──────────────────────────────────────────────────────
-- A versão anterior aplicava preço da Anthropic a TODA linha do llm_usage,
-- inclusive as de outro provedor. Agora só modelo claude entra no custo; os
-- demais aparecem contados à parte, visíveis em vez de silenciosamente errados.
-- DROP antes: a assinatura de retorno mudou (colunas novas), e o Postgres nao
-- permite create or replace alterando OUT parameters.
drop function if exists public.admin_metricas(timestamptz);

create or replace function public.admin_metricas(p_desde timestamptz)
returns table (
  user_id           uuid,
  email             text,
  empresa           text,
  criado_em         timestamptz,
  conversas_bot     bigint,
  respostas_bot     bigint,
  tokens_entrada    bigint,
  tokens_saida      bigint,
  tokens_cache_w    bigint,
  tokens_cache_r    bigint,
  tokens_total      bigint,
  chamadas_outras   bigint,
  custo_total_usd   numeric,
  custo_medio_usd   numeric,
  custo_p90_usd     numeric,
  ultima_atividade  timestamptz,
  whatsapp_ativo    boolean,
  suspenso          boolean,
  suspenso_em       timestamptz,
  bot_enabled       boolean,
  billing_day       smallint,
  billing_amount    numeric,
  pago_mes_atual    boolean,
  pago_em           timestamptz
)
language sql
security definer
set search_path = ''
as $$
  with claude as (
    -- Preços claude-sonnet-4-6 por 1M de tokens: entrada 3,00 | saída 15,00 |
    -- escrita de cache 3,75 (1,25x) | leitura de cache 0,30 (0,1x).
    -- A leitura entra separada porque custa um décimo da entrada, e este bot
    -- usa cache pesado — somar tudo como entrada multiplicaria a conta.
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
       and coalesce(u.model, '') like 'claude%'
     group by u.user_id, u.conversation_id
  ),
  consumo as (
    select c.user_id,
           count(*)                                                                 as conversas_bot,
           round(sum(c.custo)::numeric, 4)                                          as custo_total_usd,
           round(avg(c.custo)::numeric, 4)                                          as custo_medio_usd,
           round((percentile_cont(0.9) within group (order by c.custo))::numeric, 4) as custo_p90_usd
      from claude c
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
