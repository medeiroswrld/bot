-- 103 — os campos que a NF-e exige e o sistema não tinha
--
-- Descobertos lendo a documentação do provedor, antes da primeira emissão. Os
-- dois teriam passado pela nossa validação e sido recusados pela SEFAZ — que
-- responde com código numérico, às vezes minutos depois, com o cliente parado
-- esperando para levar o carro.
--
-- ── 1. NCM ─────────────────────────────────────────────────────────────────
--
-- Obrigatório em todo item de NF-e: oito dígitos que classificam a mercadoria
-- na nomenclatura do Mercosul. Carro e moto têm NCMs diferentes, e dentro de
-- carro muda por motorização.
--
-- Fica em DOIS lugares de propósito: um padrão da loja, que cobre o caso comum
-- de quem vende só um tipo, e um por veículo, para a revenda que mistura carro
-- e moto. O do veículo vence quando existe.
--
-- O sistema não escolhe NCM, como não escolhe CFOP. Classificação fiscal errada
-- é autuação no cliente, e quem responde por ela é o contador dele.
--
-- ── 2. Endereço estruturado do comprador ───────────────────────────────────
--
-- `buyer_address` é texto corrido — "Rua José Bonifácio, 296 - Guareí - SP" —
-- porque nasceu para imprimir no contrato, onde texto corrido serve. A NF-e
-- precisa dos pedaços separados, e principalmente do CEP e da UF, que definem
-- a tributação interestadual.
--
-- Partir o texto por vírgula aqui seria chute: endereço brasileiro não tem
-- formato fixo, e errar a UF troca o imposto da operação. Os campos novos são
-- preenchidos pelo vendedor, e só são exigidos quando a loja emite nota.

alter table public.company_settings
  add column if not exists nf_ncm text;

comment on column public.company_settings.nf_ncm is
  'NCM padrao da loja (8 digitos). Definido pelo contador — o sistema nao escolhe classificacao fiscal.';

alter table public.cars
  add column if not exists ncm             text,
  add column if not exists buyer_numero    text,
  add column if not exists buyer_bairro    text,
  add column if not exists buyer_municipio text,
  add column if not exists buyer_uf        text,
  add column if not exists buyer_cep       text;

comment on column public.cars.ncm is
  'NCM deste veiculo. Vence o padrao da loja — existe para revenda que mistura carro e moto.';
comment on column public.cars.buyer_uf is
  'UF do comprador. Define a tributacao interestadual: errar aqui troca o imposto da operacao.';

-- Quem já está pronto para emitir. Serve à tela, e evita que o lojista
-- descubra o que falta só no momento em que clica para emitir.
create or replace view public.vendas_prontas_para_nf as
  select c.id        as car_id,
         c.user_id,
         c.brand, c.model, c.sold_at,
         (c.purchase_price is not null and c.purchase_price > 0)                as tem_preco_compra,
         (coalesce(c.buyer_cpf, '') <> '')                                      as tem_cpf,
         (coalesce(c.buyer_cep, '') <> '' and coalesce(c.buyer_uf, '') <> ''
          and coalesce(c.buyer_municipio, '') <> '')                            as tem_endereco_fiscal,
         (coalesce(c.chassi, '') <> '')                                         as tem_chassi,
         (coalesce(c.ncm, '') <> '' or coalesce(cs.nf_ncm, '') <> '')           as tem_ncm
    from public.cars c
    join public.company_settings cs on cs.user_id = c.user_id
   where c.status = 'sold';

comment on view public.vendas_prontas_para_nf is
  'O que falta em cada venda para a nota poder ser emitida. Existe para a falta aparecer ANTES do clique, nao depois da recusa da SEFAZ.';

alter view public.vendas_prontas_para_nf set (security_invoker = on);
