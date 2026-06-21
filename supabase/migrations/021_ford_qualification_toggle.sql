-- 021_ford_qualification_toggle.sql
-- Quais categorias da qualificação FORD estão ativas por concessionária.
-- JSONB com booleans; default = tudo ativo. O ADD COLUMN com DEFAULT constante
-- preenche as linhas existentes (Postgres), então todos os tenants já ficam
-- com as 4 categorias ativas. Idempotente.

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS ford_qualification jsonb
    DEFAULT '{"family": true, "occupation": true, "recreation": true, "financial": true}'::jsonb;
