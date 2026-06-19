-- 018_delayed_schedule_enabled.sql
-- Liga/desliga a "verificação simulada de agenda" por concessionária.
-- ON  = bot diz "vou verificar com meu superior" e responde depois (delayed check).
-- OFF = bot oferece alternativas na hora, mantendo o tom humano.
-- Default true. O toggle afeta só o prompt do bot; a função
-- check-pending-schedules sempre resolve registros pendentes que existirem.

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS delayed_schedule_enabled boolean DEFAULT true;
