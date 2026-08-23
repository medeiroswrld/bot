-- 063 — liga o lead à venda que ele fechou
--
-- O status 'vendido' já existia na lista de leads, mas ninguém marcava: a venda
-- acontece na tela de estoque e o lead ficava parado em "atendimento" para
-- sempre. Resultado: não dava para separar quem comprou de quem só olhou, que é
-- a informação que diz se o atendimento está convertendo.
--
-- `sold_car_id` é SEPARADO de `car_id` de propósito. O `car_id` guarda o veículo
-- pelo qual o lead se interessou; comprar outro é comum e normal. Sobrescrever
-- apagaria justamente o dado que mostra a diferença entre o que atraiu e o que
-- fechou.

alter table public.leads
  add column if not exists sold_car_id uuid references public.cars(id) on delete set null,
  add column if not exists sold_at     timestamptz;

comment on column public.leads.sold_car_id is
  'Veículo que este lead efetivamente comprou. Diferente de car_id, que é o veículo de interesse.';

create index if not exists leads_sold_car_id_idx
  on public.leads (sold_car_id)
  where sold_car_id is not null;
