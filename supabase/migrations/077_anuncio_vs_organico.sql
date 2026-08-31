-- 077 — separar anúncio pago de publicação orgânica no relatório
--
-- Os dois primeiros cliques reais da DSC (31/08) mostraram o problema:
--
--   Reinaldo  source_type = 'ad'    ctwa_clid presente
--   Léo       source_type = 'post'  ctwa_clid AUSENTE
--
-- A Meta manda `referral` tanto em anúncio pago quanto em publicação orgânica
-- com botão de WhatsApp. Só o pago tem identificador de clique — o orgânico
-- não tem como ser atribuído, nem agora nem depois.
--
-- Na tela os dois apareciam com o mesmo título, um embaixo do outro, sem
-- nenhuma diferença visível. Comparar o desempenho de um anúncio com o de um
-- post orgânico e decidir onde investir a partir disso leva à conclusão
-- errada — e o lojista não teria como saber.
--
-- `atribuiveis` conta quantos daqueles leads têm clique. Quando for menor que
-- `leads`, parte daquela linha nunca vai virar conversão na Meta, e a tela
-- precisa dizer isso em vez de deixar o número parecendo perda.

drop view if exists public.anuncio_desempenho;

create view public.anuncio_desempenho
with (security_invoker = true)
as
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
  count(distinct l.id) filter (where l.status = 'vendido')   as vendas,
  coalesce(sum(c.sold_price) filter (where l.status = 'vendido'), 0) as faturamento,
  min(r.created_at)                                         as primeiro_clique,
  max(r.created_at)                                         as ultimo_clique
from public.ad_referrals r
left join public.leads l on l.id = r.lead_id
left join public.cars  c on c.id = l.sold_car_id
where r.source_id is not null
group by r.user_id, r.source_id;

comment on view public.anuncio_desempenho is
  'Desempenho por origem. source_type separa anúncio pago de publicação orgânica; atribuiveis diz quantos leads têm clique e portanto podem virar conversão na Meta.';
