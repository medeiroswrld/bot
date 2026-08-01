-- ============================================================================
-- 014_whatsapp_business_account_id.sql
-- WABA (WhatsApp Business Account) ID por tenant.
--
-- Antes, o WABA ID estava hardcoded nas Edge Functions de template
-- (check-template-status e submit-template-to-meta). Como o sistema é
-- multi-tenant (cada concessionária tem seu próprio WABA), o ID passa a ser
-- lido desta coluna, com fallback para o secret WHATSAPP_BUSINESS_ACCOUNT_ID.
--
-- Idempotente: pode ser reexecutada sem erro.
-- ============================================================================

alter table public.company_settings
  add column if not exists whatsapp_business_account_id text;

comment on column public.company_settings.whatsapp_business_account_id is
  'WhatsApp Business Account (WABA) ID da concessionária, usado nas chamadas de template à Graph API da Meta.';
