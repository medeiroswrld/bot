-- 087 — data de nascimento do comprador
--
-- A campanha de aniversário já existe (send-birthday-messages, migration 012) e
-- lê `leads.birth_date`. O que faltava era CAPTURAR a data, e a venda é o único
-- momento em que a loja tem o documento do cliente na mão.
--
-- Guarda nos dois lugares, de propósito:
--
--   cars.buyer_birth_date  — faz parte do registro daquela venda, e alguns
--                            contratos de loja pedem a data de nascimento na
--                            qualificação do comprador
--
--   leads.birth_date       — é de onde a campanha lê; já existia
--
-- Duplicar parece errado até lembrar que são coisas diferentes: uma é o
-- documento histórico da venda, a outra é o cadastro vivo da pessoa. Se o lead
-- for editado depois, a venda não muda — e é assim que tem que ser.

alter table public.cars
  add column if not exists buyer_birth_date date;

comment on column public.cars.buyer_birth_date is
  'Data de nascimento do comprador, coletada na venda. Copiada para leads.birth_date, que é de onde a campanha de aniversário lê.';
