-- 055 — Contrato de compra e venda gerado na hora da venda
--
-- Hoje a venda registra preço, data e vendedor. Não há dado do comprador nem
-- documento — a loja imprime contrato à parte, redigita tudo e erra CPF.

-- ── Dados que faltavam no veículo ────────────────────────────────────────────
-- Placa não existia: a consulta de placa (039) é avulsa, não fica no cadastro.
-- Sem ela não há contrato válido.
alter table public.cars
  add column if not exists plate  text,
  add column if not exists chassi text;

-- ── Comprador desta venda ────────────────────────────────────────────────────
-- Vai em `cars` porque hoje é uma venda por veículo — mesmo lugar de
-- sold_price/sold_at/sold_by. Quando o estoque com quantidade entrar (ver a
-- análise adiada), isso migra junto com eles para a tabela `sales`.
alter table public.cars
  add column if not exists buyer_name     text,
  add column if not exists buyer_cpf      text,
  add column if not exists buyer_rg       text,
  add column if not exists buyer_address  text,
  add column if not exists buyer_phone    text,
  add column if not exists payment_terms  text;

comment on column public.cars.buyer_cpf is
  'CPF do comprador. Dado pessoal: só aparece no contrato e na tela de venda, nunca no painel do administrador.';

-- ── Dados da loja que o contrato exige ───────────────────────────────────────
alter table public.company_settings
  add column if not exists cnpj              text,
  add column if not exists contract_template text;

comment on column public.company_settings.contract_template is
  'Modelo de contrato em HTML com marcadores {{campo}}. NULL = usa o padrão do sistema.';
