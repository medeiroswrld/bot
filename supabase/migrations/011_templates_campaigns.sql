-- ============================================================================
-- TEMPLATES (modelos de mensagem aprovados pela Meta)
-- ============================================================================

CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  meta_template_name TEXT NOT NULL,
  meta_template_id TEXT,

  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  language TEXT NOT NULL DEFAULT 'pt_BR',

  header_type TEXT CHECK (header_type IS NULL OR header_type IN ('TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT')),
  header_content TEXT,
  body_text TEXT NOT NULL,
  body_variables JSONB DEFAULT '[]'::jsonb,
  footer_text TEXT,
  buttons JSONB DEFAULT '[]'::jsonb,

  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending', 'approved', 'rejected', 'paused', 'disabled'
  )),
  rejection_reason TEXT,

  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  last_status_check TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, meta_template_name)
);

CREATE INDEX IF NOT EXISTS idx_message_templates_user_status ON message_templates(user_id, status);

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own templates"   ON message_templates;
DROP POLICY IF EXISTS "Users insert own templates" ON message_templates;
DROP POLICY IF EXISTS "Users update own templates" ON message_templates;
DROP POLICY IF EXISTS "Users delete own templates" ON message_templates;
CREATE POLICY "Users see own templates"   ON message_templates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own templates" ON message_templates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own templates" ON message_templates FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own templates" ON message_templates FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_message_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_message_templates_updated_at ON message_templates;
CREATE TRIGGER trigger_message_templates_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION update_message_templates_updated_at();

-- ============================================================================
-- CAMPANHAS
-- ============================================================================

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES message_templates(id) ON DELETE RESTRICT,

  name TEXT NOT NULL,

  audience_type TEXT NOT NULL CHECK (audience_type IN (
    'all_leads', 'leads_by_status', 'leads_inactive', 'leads_by_interest_vehicle', 'custom_phones'
  )),
  audience_filter JSONB DEFAULT '{}'::jsonb,
  template_variables JSONB DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'scheduled', 'sending', 'completed', 'failed', 'cancelled'
  )),

  recipients_count INT DEFAULT 0,
  sent_count INT DEFAULT 0,
  delivered_count INT DEFAULT 0,
  read_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,

  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user_status ON campaigns(user_id, status);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own campaigns"   ON campaigns;
DROP POLICY IF EXISTS "Users insert own campaigns" ON campaigns;
DROP POLICY IF EXISTS "Users update own campaigns" ON campaigns;
DROP POLICY IF EXISTS "Users delete own campaigns" ON campaigns;
CREATE POLICY "Users see own campaigns"   ON campaigns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own campaigns" ON campaigns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own campaigns" ON campaigns FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own campaigns" ON campaigns FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trigger_campaigns_updated_at ON campaigns;
CREATE TRIGGER trigger_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_message_templates_updated_at();

-- ============================================================================
-- CAMPAIGN_SENDS
-- ============================================================================

CREATE TABLE IF NOT EXISTS campaign_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'sent', 'delivered', 'read', 'failed'
  )),

  whatsapp_message_id TEXT,
  error_message TEXT,

  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_sends_campaign ON campaign_sends(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_wamid ON campaign_sends(whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;

ALTER TABLE campaign_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own campaign sends" ON campaign_sends;
CREATE POLICY "Users see own campaign sends" ON campaign_sends FOR SELECT USING (
  campaign_id IN (SELECT id FROM campaigns WHERE user_id = auth.uid())
);

-- ============================================================================
-- Incremento atômico de contadores de campanha (usado pelo webhook)
-- ============================================================================
CREATE OR REPLACE FUNCTION increment_campaign_counter(campaign_id UUID, field_name TEXT)
RETURNS VOID AS $$
BEGIN
  EXECUTE format('UPDATE campaigns SET %I = COALESCE(%I, 0) + 1 WHERE id = $1', field_name, field_name)
  USING campaign_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- LEADS: aniversário
-- ============================================================================
ALTER TABLE leads ADD COLUMN IF NOT EXISTS birth_date DATE;

-- ============================================================================
-- COMPANY_SETTINGS: templates de aniversário e lista de espera
-- ============================================================================
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS birthday_template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS birthday_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS waiting_list_template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL;

-- Realtime (para a página de templates e campanhas atualizarem sozinhas)
ALTER PUBLICATION supabase_realtime ADD TABLE message_templates;
ALTER PUBLICATION supabase_realtime ADD TABLE campaigns;
ALTER PUBLICATION supabase_realtime ADD TABLE campaign_sends;
