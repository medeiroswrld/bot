-- 015_payment_methods.sql
-- Formas de pagamento configuráveis pela concessionária.
-- O dono da loja marca quais formas aceita; o bot consulta essa lista
-- ao responder dúvidas sobre pagamento (process-conversation).

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS payment_methods text[];
