-- 061 — veículo dado na troca, e os dois campos que faltavam no contrato
--
-- O contrato real de uma loja (modelo da DSC) tem cláusulas inteiras sobre o
-- veículo recebido em troca: quem responde por multa até a transferência, o que
-- acontece se aparecer vício oculto, como se calcula o troco. Sem guardar esse
-- veículo, essas cláusulas saem em branco — e são justamente as que existem para
-- proteger a loja.
--
-- Ficam na própria linha do carro vendido, como já ficam os dados do comprador
-- (055). A troca pertence àquela venda, não é entidade solta: um dia o veículo
-- recebido vira estoque, mas aí ele entra como carro novo, com cadastro próprio.

alter table public.cars
  -- O contrato pede Renavam, e o cadastro nunca teve. A consulta por placa
  -- também não devolve — nenhum fornecedor entrega Renavam —, então este é
  -- preenchido à mão mesmo.
  add column if not exists renavam    text,
  -- "Ano Fabricação/Modelo: 2010/2010" aparece no contrato e nos portais. A
  -- consulta de placa já traz os dois separados desde a Placa Fipe.
  add column if not exists model_year integer,

  add column if not exists trade_in_plate   text,
  add column if not exists trade_in_brand   text,
  add column if not exists trade_in_model   text,
  add column if not exists trade_in_year    text,
  add column if not exists trade_in_color   text,
  add column if not exists trade_in_chassi  text,
  add column if not exists trade_in_renavam text,
  add column if not exists trade_in_km      integer,
  add column if not exists trade_in_value   numeric;

comment on column public.cars.renavam is
  'Renavam do veículo. Preenchido à mão: nenhuma consulta por placa devolve este dado.';

comment on column public.cars.model_year is
  'Ano do modelo, separado do ano de fabricação. Exigido pelo contrato e pela Webmotors.';

comment on column public.cars.trade_in_plate is
  'Veículo recebido em troca NESTA venda. Não é estoque: quando entrar para revenda, vira um cadastro próprio.';

comment on column public.cars.trade_in_value is
  'Valor pelo qual o veículo da troca foi avaliado, abatido do preço de venda.';
