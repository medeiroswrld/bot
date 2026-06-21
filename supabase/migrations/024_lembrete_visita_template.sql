-- 024_lembrete_visita_template.sql
-- Cria o template "lembrete_visita" (UTILITY, draft) para cada tenant existente,
-- pronto para o usuário clicar "Enviar pra aprovação" na UI de Templates.
-- NÃO submete à Meta — apenas a estrutura no banco.
-- Idempotente (ON CONFLICT pela UNIQUE user_id + meta_template_name).
-- Obs: tenants novos (signup futuro) devem receber este template no fluxo de
-- cadastro — este seed cobre só os tenants já existentes.

INSERT INTO message_templates
  (user_id, meta_template_name, display_name, category, language, body_text, body_variables, status)
SELECT
  cs.user_id,
  'lembrete_visita',
  'Lembrete de Visita',
  'UTILITY',
  'pt_BR',
  'Oi {{1}}! Tá chegando o horário da sua visita às {{2}}.

Estamos te esperando aqui na {{3}}. 📍 {{4}}

Qualquer coisa é só me chamar! 😊',
  '[{"example":"João"},{"example":"14h"},{"example":"Auto DSC"},{"example":"Av. Brasil, 1000 - Centro"}]'::jsonb,
  'draft'
FROM company_settings cs
ON CONFLICT (user_id, meta_template_name) DO NOTHING;
