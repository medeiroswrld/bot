-- 082 — ficha de compra do veículo, visível só para a loja
--
-- A loja precisa registrar de quem comprou, quando, e se o veículo tem
-- financiamento em aberto. Hoje isso vive na cabeça de alguém ou num caderno —
-- e some quando a pessoa sai de férias.
--
-- ── Por que colunas novas, e não `description` ──────────────────────────────
--
-- `description` é lido por DOIS caminhos que chegam ao cliente:
--   • o bot (consultar_estoque manda como "observacoes" e ele usa na conversa)
--   • o feed público (estoque-publico expõe no site da loja)
--
-- Escrever "comprei do Zé por 18 mil, tem financiamento no Bradesco" ali faria
-- o bot contar isso pro comprador. Precisa ser campo separado.
--
-- ── Por que é seguro ────────────────────────────────────────────────────────
--
-- O bot e o feed selecionam colunas por LISTA EXPLÍCITA, não `select(*)`. Então
-- coluna nova nasce invisível para os dois, sem precisar lembrar de excluir.
-- Só o CRM, que lê com `select('*')` sob a RLS do dono, enxerga.
--
-- Quem for adicionar campo privado no futuro: confira que continua assim, em
-- estoque-publico/index.ts e no consultar_estoque do process-conversation.

alter table public.cars
  add column if not exists purchase_date     date,
  add column if not exists purchase_from     text,
  add column if not exists purchase_financed boolean not null default false,
  add column if not exists purchase_notes    text;

comment on column public.cars.purchase_date is
  'Quando a loja comprou o veículo. Privado — nunca sai no feed nem para o bot.';
comment on column public.cars.purchase_from is
  'De quem a loja comprou. Privado.';
comment on column public.cars.purchase_financed is
  'Veículo tem financiamento/gravame em aberto. Privado, mas decisivo na negociação.';
comment on column public.cars.purchase_notes is
  'Observações internas da compra. Privado — o campo público é `description`.';

-- ── O carro que vem na troca já sabe de quem veio ───────────────────────────
--
-- A 079 cria o veículo da troca automaticamente. Aqui ele passa a nascer com a
-- ficha de compra preenchida: comprado do COMPRADOR do carro vendido, na data
-- da venda. É a informação mais confiável possível, e ninguém precisa digitar.
create or replace function public.cria_veiculo_da_troca()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ano int;
begin
  if new.status <> 'sold' or coalesce(new.trade_in_plate, '') = '' then
    return new;
  end if;

  if exists (select 1 from public.cars c where c.origem_troca_de = new.id) then
    return new;
  end if;

  v_ano := nullif(substring(coalesce(new.trade_in_year, '') from '\d{4}'), '')::int;
  if v_ano is not null and (v_ano < 1900 or v_ano > 2100) then
    v_ano := null;
  end if;

  insert into public.cars (
    user_id, brand, model, year, model_year, color, mileage,
    plate, chassi, renavam,
    purchase_price, purchase_date, purchase_from, purchase_notes,
    price, status, vehicle_type,
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
    new.trade_in_value,
    coalesce(new.sold_at::date, current_date),
    -- De quem veio: o comprador do carro vendido entregou este na troca.
    nullif(new.buyer_name, ''),
    'Recebido na troca da venda de ' ||
      coalesce(nullif(new.brand, '') || ' ', '') ||
      coalesce(nullif(new.model, ''), 'veículo') ||
      coalesce(' (placa ' || nullif(new.plate, '') || ')', ''),
    null,
    'incoming',
    coalesce(nullif(new.vehicle_type, ''), 'carro'),
    new.id,
    -- `description` é público: aqui vai só o que o cliente pode ler.
    'Veículo recebido em negociação.'
  );

  return new;
end;
$$;
