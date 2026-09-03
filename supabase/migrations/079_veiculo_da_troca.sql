-- 079 — o carro da troca entra no estoque sozinho
--
-- Hoje o veículo que entra na troca é digitado no contrato, guardado nas
-- colunas trade_in_* do carro VENDIDO, e some. Alguém digita tudo de novo pra
-- cadastrar o carro que acabou de chegar no pátio — o mesmo carro, os mesmos
-- dados, duas vezes, e a segunda com chance de erro.
--
-- ── Por que um STATUS novo, e não um campo "pendente" ───────────────────────
--
-- O carro da troca NÃO pode ser vendido no instante em que entra: não foi
-- avaliado, não tem foto, e não tem preço de venda — só o valor que a loja deu
-- por ele. Se entrasse como 'available', o bot ofereceria na hora, por R$ 0.
--
-- O bot e o feed público filtram `status in ('available','reserved')`. Um valor
-- novo fica de fora dos dois SEM precisar mudar uma linha de código deles —
-- que é o tipo de mudança que não quebra nada por esquecimento.

-- ── 1. Novo status ──────────────────────────────────────────────────────────
alter table public.cars drop constraint if exists cars_status_check;
alter table public.cars add constraint cars_status_check
  check (status in ('available', 'reserved', 'sold', 'incoming'));

comment on constraint cars_status_check on public.cars is
  'incoming = chegou pela troca e ainda não foi precificado. Fora do bot e do feed até virar available.';

-- ── 2. De onde veio ─────────────────────────────────────────────────────────
alter table public.cars
  add column if not exists origem_troca_de uuid references public.cars(id) on delete set null;

comment on column public.cars.origem_troca_de is
  'O carro vendido cuja troca gerou este. Também é a chave de idempotência.';

-- Um carro de troca por venda. Sem isto, editar a venda depois criaria outro
-- — mesmo padrão do `ref` no financeiro e do event_id no CAPI.
create unique index if not exists cars_origem_troca_uniq
  on public.cars (origem_troca_de)
  where origem_troca_de is not null;

-- ── 3. O gatilho ────────────────────────────────────────────────────────────
create or replace function public.cria_veiculo_da_troca()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ano int;
begin
  -- Só quando a venda fecha, e só se veio carro na troca.
  if new.status <> 'sold' or coalesce(new.trade_in_plate, '') = '' then
    return new;
  end if;

  -- Não repete numa reedição da venda.
  if exists (select 1 from public.cars c where c.origem_troca_de = new.id) then
    return new;
  end if;

  -- trade_in_year é texto e chega como "2012", "2012/2013" ou vazio. Pega os
  -- quatro primeiros dígitos; o que não for ano plausível fica nulo em vez de
  -- explodir o gatilho e derrubar a venda inteira.
  v_ano := nullif(substring(coalesce(new.trade_in_year, '') from '\d{4}'), '')::int;
  if v_ano is not null and (v_ano < 1900 or v_ano > 2100) then
    v_ano := null;
  end if;

  insert into public.cars (
    user_id, brand, model, year, model_year, color, mileage,
    plate, chassi, renavam,
    purchase_price, price, status, vehicle_type,
    origem_troca_de, description
  )
  values (
    new.user_id,
    nullif(new.trade_in_brand, ''),
    coalesce(nullif(new.trade_in_model, ''), 'Veículo da troca'),
    v_ano,
    v_ano,
    nullif(new.trade_in_color, ''),
    new.trade_in_km,
    nullif(new.trade_in_plate, ''),
    nullif(new.trade_in_chassi, ''),
    nullif(new.trade_in_renavam, ''),
    -- O que a loja deu pelo carro é o custo dele. Já entra no lucro por
    -- veículo sem ninguém lançar nada à mão.
    new.trade_in_value,
    -- Preço de VENDA fica nulo de propósito: ninguém sabe ainda. É o que
    -- obriga a passar pela precificação antes de ir pro anúncio.
    null,
    'incoming',
    coalesce(nullif(new.vehicle_type, ''), 'carro'),
    new.id,
    'Entrou na troca da venda de ' ||
      coalesce(nullif(new.brand, '') || ' ', '') ||
      coalesce(nullif(new.model, ''), 'veículo') ||
      coalesce(' (placa ' || nullif(new.plate, '') || ')', '')
  );

  return new;
end;
$$;

drop trigger if exists trg_veiculo_da_troca on public.cars;
create trigger trg_veiculo_da_troca
  after update of status, trade_in_plate on public.cars
  for each row
  execute function public.cria_veiculo_da_troca();
