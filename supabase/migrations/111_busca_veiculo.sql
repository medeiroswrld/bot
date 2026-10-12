-- 111 — uma coluna só para procurar veículo
--
-- ── O defeito ─────────────────────────────────────────────────────────────
--
-- O cliente escreve o carro como ele fala: "Onix 1.4 LTZ". O banco guarda
-- isso partido em três colunas:
--
--     brand    "CHEVROLET "
--     model    "ONIX "
--     version  "1.4 LTZ"
--
-- A busca procurava a FRASE INTEIRA em cada coluna, uma de cada vez:
--
--     model.ilike.%Onix 1.4 LTZ%      → não casa
--     version.ilike.%Onix 1.4 LTZ%    → não casa
--
-- A frase atravessa duas colunas, então nenhuma casa sozinha. Resultado medido
-- em produção: "Onix" achava 4 carros, "Onix 1.4 LTZ" achava zero.
--
-- E o efeito não era um resultado vazio e pronto: o assistente tentou cinco
-- buscas seguidas, todas vazias, e terminou dizendo ao cliente "não estou
-- conseguindo puxar as fotos do sistema" — com o carro no pátio.
--
-- ── Por que uma coluna gerada ─────────────────────────────────────────────
--
-- Com marca, modelo e versão num texto só, a busca passa a ser por PALAVRA:
-- "Onix" e "1.4" e "LTZ" precisam aparecer, não importa em qual campo cada uma
-- estava. É como a pessoa pensa o nome do carro.
--
-- Gerada e `stored`, não uma view nem concatenação na consulta: o PostgREST
-- não concatena colunas num filtro, e manter isso à mão desencontraria no
-- primeiro cadastro que alguém editasse.

alter table public.cars
  add column if not exists busca_texto text
  generated always as (
    coalesce(brand, '') || ' ' || coalesce(model, '') || ' ' || coalesce(version, '')
  ) stored;

comment on column public.cars.busca_texto is
  'Marca, modelo e versao num texto so, para busca por palavra. O cliente escreve "Onix 1.4 LTZ" e isso vive em tres colunas — procurar a frase em cada uma separadamente nunca casa.';

-- O volume por loja é de dezenas a poucas centenas de carros, então o índice
-- não é sobre velocidade: é sobre o `ilike '%palavra%'` não virar varredura da
-- tabela inteira quando houver muitas lojas no mesmo banco.
create extension if not exists pg_trgm;

create index if not exists idx_cars_busca_texto
  on public.cars using gin (busca_texto gin_trgm_ops);
