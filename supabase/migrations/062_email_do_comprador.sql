-- 062 — e-mail do comprador
--
-- A cláusula de comunicação entre as partes, no contrato de loja, elege e-mail
-- e telefone como meios oficiais de notificação. O telefone o sistema já tinha;
-- o e-mail saía como linha em branco justamente na cláusula que diz por onde a
-- loja pode notificar o comprador.
--
-- Opcional de propósito: venda sem e-mail continua válida, e travar isso
-- impediria de fechar negócio no sistema por causa de um campo.

alter table public.cars
  add column if not exists buyer_email text;

comment on column public.cars.buyer_email is
  'E-mail do comprador. Dado pessoal: só aparece no contrato e na tela de venda, nunca no painel do administrador.';
