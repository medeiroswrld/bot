-- 112 — os campos fiscais que faltavam na nota
--
-- ── O defeito ─────────────────────────────────────────────────────────────
--
-- A `emitir-nf` mandava CFOP e NCM e mais nada de imposto. O item ia com o
-- preço de venda cheio como valor, sem CST, sem base de cálculo, sem alíquota.
--
-- Veículo usado é tributado sobre a MARGEM, ou sobre uma base reduzida — não
-- sobre o valor da venda. Emitir assim é emitir com a base errada, que é
-- exatamente o risco que o comentário da própria função diz querer evitar: não
-- vira um bug para corrigir na segunda-feira, vira autuação no cliente.
--
-- Os campos obrigatórios para CST 20, segundo a documentação da Focus:
--
--     icms_origem · icms_situacao_tributaria · icms_modalidade_base_calculo
--     icms_reducao_base_calculo · icms_base_calculo · icms_aliquota · icms_valor
--
-- ── Por que NADA aqui tem valor padrão de imposto ─────────────────────────
--
-- Toda coluna fiscal nasce nula, e a função RECUSA emitir enquanto estiverem
-- nulas. O sistema não escolhe tributação — ele transmite o que o contador da
-- loja definiu. Um default aqui seria o sistema opinando sobre imposto de um
-- terceiro, em 27 estados com regras diferentes.
--
-- As únicas colunas com default são as que não são decisão fiscal: origem
-- (0 = nacional) e modalidade da base (3 = valor da operação).
--
-- ── Por que o CFOP virou DOIS, e um campo no veículo ──────────────────────
--
-- A Resposta à Consulta 23496/2021 de São Paulo diz que a redução de base não
-- se aplica quando a entrada do veículo foi onerada pelo ICMS. Ou seja: o
-- mesmo pátio pode ter carro que entra no benefício (comprado de pessoa
-- física) e carro que não entra (comprado com ICMS destacado) — e eles saem
-- com CFOP e CST diferentes.
--
-- Um único `nf_cfop` por loja não dá conta disso. Daí `entrada_com_icms` no
-- veículo e o segundo CFOP na loja.
--
-- As fontes divergem: guias de contabilidade não mencionam essa condição, a
-- consulta de SP menciona. A divergência é o motivo de o campo existir e de a
-- resposta ser do contador, não nossa.

-- ── Loja ───────────────────────────────────────────────────────────────────

alter table public.company_settings
  add column if not exists nf_cst                  text,
  add column if not exists nf_icms_aliquota        numeric(5,2),
  add column if not exists nf_icms_reducao_base    numeric(5,2),
  add column if not exists nf_base_modo            text,
  add column if not exists nf_cfop_tributado       text,
  add column if not exists nf_info_complementar    text,
  add column if not exists nf_icms_origem          text default '0',
  add column if not exists nf_icms_modalidade_bc   text default '3';

comment on column public.company_settings.nf_cst is
  'CST (regime normal) ou CSOSN (Simples Nacional) da operacao. "20" = tributada com reducao de base. Vem do contador — a doc da Focus usa "20", nao "020".';
comment on column public.company_settings.nf_icms_aliquota is
  'Aliquota de ICMS da operacao, em percentual. Do contador.';
comment on column public.company_settings.nf_icms_reducao_base is
  'Percentual de reducao da base de calculo. Varia por estado e ja mudou no tempo (SP era 90% ate 14/01/2021). Do contador.';
comment on column public.company_settings.nf_base_modo is
  'Como a base e apurada: `reducao` (percentual sobre o valor da venda), `margem` (venda menos compra) ou `integral`. Sao mecanismos DIFERENTES e as fontes divergem sobre qual se aplica — quem decide e o contador.';
comment on column public.company_settings.nf_cfop_tributado is
  'CFOP para o veiculo que NAO entra no beneficio (entrou com ICMS destacado). Nulo = a loja so trabalha com veiculos que entram no beneficio.';
comment on column public.company_settings.nf_info_complementar is
  'Citacao da legislacao que concede a reducao de base. Vai nas informacoes complementares da nota e e exigida para fundamentar o beneficio.';

-- ── Veículo ────────────────────────────────────────────────────────────────

alter table public.cars
  add column if not exists entrada_com_icms boolean,
  add column if not exists nota_entrada     text;

comment on column public.cars.entrada_com_icms is
  'O veiculo entrou com ICMS destacado? Falso/nulo = comprado de pessoa fisica ou de quem nao destaca, caso que entra no beneficio. Verdadeiro = tributacao normal. Decide qual CFOP e CST a nota carrega.';
comment on column public.cars.nota_entrada is
  'Numero da nota de entrada deste veiculo. Vai nas informacoes complementares da nota de venda, vinculando a saida a entrada.';

-- ── Quem está pronto para emitir ───────────────────────────────────────────
--
-- A view de diagnóstico ganha as colunas fiscais: antes ela dizia que a venda
-- estava pronta quando faltava metade do imposto.

drop view if exists public.vendas_prontas_para_nf;

create view public.vendas_prontas_para_nf as
select
  c.id as car_id,
  c.user_id,
  c.brand,
  c.model,
  c.sold_at,
  c.purchase_price is not null and c.purchase_price > 0            as tem_preco_compra,
  coalesce(c.buyer_cpf, '') <> ''                                  as tem_cpf,
  coalesce(c.buyer_cep, '') <> '' and coalesce(c.buyer_uf, '') <> ''
    and coalesce(c.buyer_municipio, '') <> ''                      as tem_endereco_fiscal,
  coalesce(c.chassi, '') <> ''                                     as tem_chassi,
  coalesce(c.ncm, '') <> '' or coalesce(cs.nf_ncm, '') <> ''       as tem_ncm,
  -- As travas fiscais novas. Sem elas a nota sai com base errada.
  coalesce(cs.nf_cst, '') <> ''                                    as tem_cst,
  cs.nf_icms_aliquota is not null                                  as tem_aliquota,
  coalesce(cs.nf_base_modo, '') <> ''                              as tem_modo_base,
  coalesce(cs.nf_cfop, '') <> ''                                   as tem_cfop
from public.cars c
join public.company_settings cs on cs.user_id = c.user_id
where c.status = 'sold';

comment on view public.vendas_prontas_para_nf is
  'Vendas e o que falta em cada uma para emitir. Diagnostico, nao filtro: lista todas as vendidas com um booleano por requisito.';
