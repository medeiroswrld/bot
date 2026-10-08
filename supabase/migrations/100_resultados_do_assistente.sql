-- 100 — o que o assistente fez nos últimos 30 dias
--
-- Nasceu de uma pergunta de cliente: "está caro". Ao medir a DSC, o problema
-- não era o preço — era não haver prova. O sistema atende 135 pessoas por mês
-- e nunca disse isso a ninguém.
--
-- ── O que entra, e por quê ─────────────────────────────────────────────────
--
-- Só número que se sustenta sozinho. Cada um responde a uma objeção real:
--
--   pessoas_atendidas   "não sei se usam"
--   fora_do_horario     "meu vendedor faz isso"  → não às 22h de domingo
--   resposta_mediana    "demora igual"           → 23 segundos na DSC
--   fotos_enviadas      "só manda texto"
--   visitas_agendadas   "não traz ninguém na loja"
--
-- ── O que NÃO entra ────────────────────────────────────────────────────────
--
-- "Vendas geradas pelo assistente" fica DE FORA, e é a decisão mais
-- importante desta migration. A atribuição hoje depende de alguém marcar a
-- venda na mão, e isso quase nunca acontece: o painel mostraria ZERO na maioria
-- dos meses. Um indicador que exibe zero quando o produto está funcionando não
-- é transparência, é um argumento contra nós mesmos — entregue ao cliente
-- justamente na conversa de renovação.
--
-- Entra quando existir o botão "esta venda veio do assistente" e dois meses de
-- uso dele. Antes disso, não.
--
-- ── Horário é de cada loja ─────────────────────────────────────────────────
--
-- "Fora do horário" usa o expediente configurado pela própria loja, não um
-- padrão nosso. Revenda que abre sábado não pode ver sábado contado como
-- fora — seria um número bonito e mentiroso, e o lojista percebe na hora.

create or replace view public.resultados_assistente as
with janela as (
  select c.id            as conversa_id,
         c.user_id,
         m.role,
         m.content,
         m.created_at,
         m.created_at at time zone 'America/Sao_Paulo' as hora_local
    from public.conversations c
    join public.messages m on m.conversation_id = c.id
   where m.created_at > now() - interval '30 days'
),
expediente as (
  select cs.user_id,
         coalesce(cs.business_hours_start, '09:00') as abre,
         coalesce(cs.business_hours_end,   '18:00') as fecha,
         coalesce(cs.working_days, 'Seg,Ter,Qua,Qui,Sex') as dias
    from public.company_settings cs
),
respostas as (
  -- Tempo até a primeira resposta do assistente. O teto de 10 minutos corta
  -- o caso em que o cliente volta horas depois: ali a demora é dele, e manter
  -- isso na conta inventaria uma lentidão que não existiu.
  select j.user_id,
         extract(epoch from (
           select min(b.created_at) from public.messages b
            where b.conversation_id = j.conversa_id
              and b.role = 'bot'
              and b.created_at > j.created_at
              -- Mensagem de falha nao e resposta. Sem este filtro, uma loja
              -- com o token quebrado exibiria "mediana de 4 segundos" — que e
              -- a velocidade com que o sistema pede desculpa, nao com que ele
              -- atende. Foi o que a Leandrinho mostrou no primeiro teste.
              and b.content not ilike 'Tive um problema t%'
              and b.content not ilike 'Recebi sua foto mas n%'
              and b.content not ilike '%não consegui ouvir%'
         ) - j.created_at) as segundos
    from janela j
   where j.role = 'customer'
)
select e.user_id,
       (select count(distinct j.conversa_id) from janela j
         where j.user_id = e.user_id and j.role = 'customer') as pessoas_atendidas,
       (select count(*) from janela j
         where j.user_id = e.user_id and j.role = 'customer'
           and (j.hora_local::time < e.abre::time
                or j.hora_local::time >= e.fecha::time
                or position(
                     (array['Dom','Seg','Ter','Qua','Qui','Sex','Sab'])
                       [extract(dow from j.hora_local)::int + 1] in e.dias
                   ) = 0)) as fora_do_horario,
       (select count(*) from janela j
         where j.user_id = e.user_id and j.role = 'bot'
           and j.content like '%[foto]%') as fotos_enviadas,
       (select round(percentile_cont(0.5) within group (order by r.segundos)::numeric, 0)
          from respostas r
         where r.user_id = e.user_id and r.segundos is not null and r.segundos < 600)
         as resposta_mediana_seg,
       (select count(*) from public.appointments a
         where a.user_id = e.user_id
           and a.created_at > now() - interval '30 days') as visitas_agendadas
  from expediente e;

comment on view public.resultados_assistente is
  'O que o assistente fez nos ultimos 30 dias, por loja. Deliberadamente SEM "vendas geradas": a atribuicao atual mostraria zero na maioria dos meses e viraria argumento contra o produto.';

alter view public.resultados_assistente set (security_invoker = on);
