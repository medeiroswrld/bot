-- Tabela de interesses (clientes esperando carros específicos)
CREATE TABLE IF NOT EXISTS vehicle_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,

  -- Dados do cliente (denormalizados pra query rápida)
  customer_phone TEXT NOT NULL,
  customer_name TEXT,

  -- Critérios de busca (todos opcionais pra permitir buscas amplas)
  brand TEXT,
  model TEXT,
  year_min INT,
  year_max INT,
  km_max INT,
  price_min NUMERIC,
  price_max NUMERIC,
  vehicle_type TEXT,
  fuel TEXT,
  transmission TEXT,
  color TEXT,

  -- Metadados
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'matched', 'notified', 'converted', 'dismissed', 'expired')),

  -- Tracking
  matches_count INT DEFAULT 0,
  notification_count INT DEFAULT 0,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Índices pra performance
CREATE INDEX IF NOT EXISTS idx_vehicle_interests_user_status
  ON vehicle_interests(user_id, status);

CREATE INDEX IF NOT EXISTS idx_vehicle_interests_model_active
  ON vehicle_interests(LOWER(model)) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_vehicle_interests_phone
  ON vehicle_interests(customer_phone);

-- RLS
ALTER TABLE vehicle_interests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own interests"   ON vehicle_interests;
DROP POLICY IF EXISTS "Users insert own interests" ON vehicle_interests;
DROP POLICY IF EXISTS "Users update own interests" ON vehicle_interests;
DROP POLICY IF EXISTS "Users delete own interests" ON vehicle_interests;

CREATE POLICY "Users see own interests" ON vehicle_interests
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own interests" ON vehicle_interests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own interests" ON vehicle_interests
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users delete own interests" ON vehicle_interests
  FOR DELETE USING (auth.uid() = user_id);

-- Trigger pra atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_vehicle_interests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_vehicle_interests_updated_at ON vehicle_interests;
CREATE TRIGGER trigger_update_vehicle_interests_updated_at
  BEFORE UPDATE ON vehicle_interests
  FOR EACH ROW EXECUTE FUNCTION update_vehicle_interests_updated_at();

-- Realtime (para o badge da sidebar atualizar sozinho)
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_interests;

COMMENT ON TABLE vehicle_interests IS 'Clientes esperando carros específicos. Sistema notifica quando carro compatível entra no estoque.';
