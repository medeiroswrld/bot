-- ============================================================================
-- 030_llm_usage.sql
-- Telemetria de custo do LLM: 1 linha por chamada ao Claude (process-conversation).
-- Permite medir tokens/custo por conversa, por conta e por dia, e validar o
-- efeito do prompt caching (cache_read vs input a preço cheio).
--
-- Escrita: só pela service role (edge function) — RLS sem policy de INSERT.
-- Leitura: dono da conta (para futuras telas de custo no CRM).
-- Idempotente: pode ser reexecutada sem erro.
-- ============================================================================

CREATE TABLE IF NOT EXISTS llm_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID,
  request_id TEXT,
  model TEXT,
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cache_creation_input_tokens INT DEFAULT 0,
  cache_read_input_tokens INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_user_created ON llm_usage(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_conversation ON llm_usage(conversation_id);

ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own llm usage" ON llm_usage;
CREATE POLICY "Users read own llm usage" ON llm_usage FOR SELECT USING (auth.uid() = user_id);
