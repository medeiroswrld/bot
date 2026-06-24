-- 027_trade_in_settings.sql
-- Configuração da pré-avaliação de troca por concessionária.
--   trade_in_evaluation_enabled: toggle único ON/OFF (default ON).
--   trade_in_extra_questions:    perguntas adicionais (texto livre, 1 por linha)
--                                que o bot deve fazer além das 6 padrão.
-- Idempotente.

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS trade_in_evaluation_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS trade_in_extra_questions text;
