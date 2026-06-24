-- 026_lead_trade_in_fields.sql
-- Pré-avaliação do carro do cliente para troca (entrada). Texto livre — o bot
-- salva respostas naturais e o atendente pode editar. trade_in_extra_info é
-- cumulativo (o handler concatena, não sobrescreve). Idempotente.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS trade_in_model text,
  ADD COLUMN IF NOT EXISTS trade_in_year text,
  ADD COLUMN IF NOT EXISTS trade_in_km text,
  ADD COLUMN IF NOT EXISTS trade_in_ownership_time text,
  ADD COLUMN IF NOT EXISTS trade_in_owner_rating text,
  ADD COLUMN IF NOT EXISTS trade_in_payment_preference text,
  ADD COLUMN IF NOT EXISTS trade_in_difference_payment text,
  ADD COLUMN IF NOT EXISTS trade_in_extra_info text;
