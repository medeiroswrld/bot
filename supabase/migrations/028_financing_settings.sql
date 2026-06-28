-- 028_financing_settings.sql
-- Parâmetros de financiamento por concessionária (config da loja).
-- A simulação roda em código (Tabela Price) numa tool do bot; aqui ficam só os
-- parâmetros que cada loja configura. Idempotente.

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS financing_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS financing_interest_rate numeric,                  -- taxa AO MÊS, em % (ex: 2.2)
  ADD COLUMN IF NOT EXISTS financing_max_installments integer DEFAULT 48,
  ADD COLUMN IF NOT EXISTS financing_min_down_payment_percent numeric DEFAULT 20,
  ADD COLUMN IF NOT EXISTS financing_banks text;
