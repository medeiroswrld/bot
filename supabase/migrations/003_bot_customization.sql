-- 003_bot_customization.sql
-- Adiciona campo de instruções personalizadas e tabela de FAQs para o bot.

-- 1. Novo campo em company_settings
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS bot_custom_instructions text;

-- 2. Tabela de perguntas frequentes
CREATE TABLE IF NOT EXISTS bot_faqs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question   text        NOT NULL,
  answer     text        NOT NULL,
  enabled    boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. RLS
ALTER TABLE bot_faqs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_faqs_select"       ON bot_faqs;
DROP POLICY IF EXISTS "bot_faqs_insert"       ON bot_faqs;
DROP POLICY IF EXISTS "bot_faqs_update"       ON bot_faqs;
DROP POLICY IF EXISTS "bot_faqs_delete"       ON bot_faqs;
DROP POLICY IF EXISTS "bot_faqs_service_role" ON bot_faqs;

CREATE POLICY "bot_faqs_select"       ON bot_faqs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "bot_faqs_insert"       ON bot_faqs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bot_faqs_update"       ON bot_faqs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "bot_faqs_delete"       ON bot_faqs FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "bot_faqs_service_role" ON bot_faqs FOR ALL USING (auth.role() = 'service_role');

-- 4. Índice
CREATE INDEX IF NOT EXISTS bot_faqs_user_id_idx ON bot_faqs(user_id);
