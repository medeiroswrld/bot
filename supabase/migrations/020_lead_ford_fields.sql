-- 020_lead_ford_fields.sql
-- Qualificação FORD do lead (Família, Ocupação, Recreação, Dinheiro).
-- Texto livre — o bot salva respostas naturais ("casado, 2 filhos",
-- "engenheiro civil", "passeio em família", "à vista até 80mil").
-- Idempotente.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS family_info text,
  ADD COLUMN IF NOT EXISTS occupation text,
  ADD COLUMN IF NOT EXISTS recreation_info text,
  ADD COLUMN IF NOT EXISTS financial_info text;
