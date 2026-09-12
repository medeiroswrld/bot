-- 088 — o carro da troca nunca mais derruba a venda
--
-- A 079 criou o gatilho que cadastra o veículo da troca sozinho. Ele nunca
-- funcionou: na primeira venda com troca depois do deploy (11/09/2026) a tela
-- devolveu "Erro ao vender veículo." e a venda inteira voltou atrás.
--
-- O motivo foi eu escrever a INTENÇÃO sem conferir a coluna contra o banco:
--
--     null value in column "price" of relation "cars" violates not-null constraint
--
-- A 079 dizia, com todas as letras, "Preço de VENDA fica nulo de propósito:
-- ninguém sabe ainda". Só que `cars.price` é NOT NULL. E não era só ele —
-- três colunas NOT NULL recebiam null do gatilho:
--
--     price  ← null fixo                        → quebrava SEMPRE
--     brand  ← nullif(trade_in_brand, '')       → quebrava sem marca
--     year   ← v_ano                            → quebrava sem ano plausível
--
-- ── Por que passou batido ───────────────────────────────────────────────────
--
-- As duas únicas vendas com troca do sistema são de 22/08 e 31/08, anteriores
-- ao gatilho. Nenhuma venda com troca passou por aqui entre o deploy e hoje,
-- então o caminho subiu quebrado e ficou quebrado, em silêncio, até o primeiro
-- lojista tentar usar.
--
-- ── As duas correções ───────────────────────────────────────────────────────
--
-- 1. Valores que não violam NOT NULL.
--
--    `price = 0` NÃO é o preço do carro — é a ausência dele. O portão que
--    segura o veículo fora do bot e do feed continua sendo o status 'incoming',
--    exatamente como a 079 desenhou; o preço nunca foi o portão. Zero tem a
--    vantagem de ser visivelmente errado na tela: ninguém anuncia por engano um
--    carro marcado R$ 0, enquanto um preço plausível chutado passaria.
--
--    Pelo mesmo motivo `year = 0` e `brand = 'A definir'`: é melhor um campo
--    que grita "me preencha" do que um dado inventado que parece verdade.
--
-- 2. O insert vai dentro de um bloco com EXCEPTION.
--
--    Esta é a correção que importa. Cadastrar o carro da troca é uma
--    CONVENIÊNCIA; a venda é o fato. Conveniência não pode derrubar fato.
--    A própria 079 já tinha esse raciocínio escrito sobre o ano ("em vez de
--    explodir o gatilho e derrubar a venda inteira") e eu não estendi ao
--    insert — que era justamente onde ele fazia falta.
--
--    Daqui pra frente, qualquer coisa que dê errado no cadastro da troca vira
--    WARNING no log do Postgres e a venda segue. Uma coluna nova NOT NULL no
--    futuro volta a quebrar o cadastro da troca, mas não a venda.

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
  -- quatro primeiros dígitos; o que não for ano plausível fica nulo.
  v_ano := nullif(substring(coalesce(new.trade_in_year, '') from '\d{4}'), '')::int;
  if v_ano is not null and (v_ano < 1900 or v_ano > 2100) then
    v_ano := null;
  end if;

  begin
    insert into public.cars (
      user_id, brand, model, year, model_year, color, mileage,
      plate, chassi, renavam,
      purchase_price, price, status, vehicle_type,
      origem_troca_de, description
    )
    values (
      new.user_id,
      -- NOT NULL: placeholder explícito em vez de null.
      coalesce(nullif(new.trade_in_brand, ''), 'A definir'),
      coalesce(nullif(new.trade_in_model, ''), 'Veículo da troca'),
      coalesce(v_ano, 0),
      v_ano,
      nullif(new.trade_in_color, ''),
      new.trade_in_km,
      nullif(new.trade_in_plate, ''),
      nullif(new.trade_in_chassi, ''),
      nullif(new.trade_in_renavam, ''),
      -- O que a loja deu pelo carro é o custo dele. Já entra no lucro por
      -- veículo sem ninguém lançar nada à mão.
      new.trade_in_value,
      -- Ausência de preço, não preço zero. Ver o cabeçalho.
      0,
      'incoming',
      coalesce(nullif(new.vehicle_type, ''), 'carro'),
      new.id,
      'Entrou na troca da venda de ' ||
        coalesce(nullif(new.brand, '') || ' ', '') ||
        coalesce(nullif(new.model, ''), 'veículo') ||
        coalesce(' (placa ' || nullif(new.plate, '') || ')', '')
    );
  exception when others then
    -- A venda continua valendo. O que se perde aqui é só o adiantamento do
    -- cadastro, que a loja consegue fazer à mão.
    raise warning '[troca] nao consegui criar o veiculo da venda %: % (SQLSTATE %)',
      new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

comment on function public.cria_veiculo_da_troca() is
  'Cadastra o veículo da troca como incoming. Falha aqui NUNCA derruba a venda (088).';
