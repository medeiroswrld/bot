-- ============================================================================
-- 032_llm_provider_por_tenant.sql
--
-- Switch de provedor de LLM POR TENANT, para testar GPT-4o mini numa loja sem
-- afetar as demais. A env var LLM_PROVIDER sozinha é global e mudaria TODOS os
-- clientes de uma vez — inclusive a DSC, que atende clientes reais.
--
-- Precedência no código (process-conversation):
--   company_settings.llm_provider  ??  env LLM_PROVIDER  ??  'anthropic'
--
-- NULL (padrão) = herda a env var = hoje, 'anthropic'. Nenhum tenant muda de
-- comportamento ao aplicar esta migration.
--
-- Reversão de um tenant, SEM deploy:
--   update company_settings set llm_provider = null where user_id = '...';
--
-- Idempotente: pode ser reexecutada sem erro.
-- ============================================================================

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS llm_provider text;

-- CHECK como rede de segurança: valor digitado errado ('gpt4', 'openai ') é
-- recusado pelo banco, em vez de o bot cair silenciosamente no Claude.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_settings_llm_provider_check'
  ) THEN
    ALTER TABLE company_settings
      ADD CONSTRAINT company_settings_llm_provider_check
      CHECK (llm_provider IS NULL OR llm_provider IN ('anthropic', 'openai'));
  END IF;
END $$;

COMMENT ON COLUMN company_settings.llm_provider IS
  'Sobrepõe a env var LLM_PROVIDER para este tenant: anthropic | openai. NULL = usa a env var (padrão anthropic).';
