-- ============================================================================
-- 117 — Eventos da loja (feirão, mutirão, semana de ofertas)
-- ============================================================================
--
-- Por que uma tabela e não colunas em company_settings:
--
-- Um feirão tem começo e fim. Se as datas e as condições morassem em
-- company_settings, o fim do evento exigiria alguém LIMPAR os campos à mão —
-- e enquanto não limpasse, o bot seguiria vendendo um feirão que já acabou.
-- Com linha própria, `data_fim < hoje` resolve sozinho, e a loja pode cadastrar
-- o feirão do mês que vem sem apagar o deste mês.
--
-- O evento é por LOJA (user_id), não da DSC: qualquer tenant cria o seu.
--
-- ATENÇÃO para quem aplicar: esta migration cria DUAS colunas `evento_id`
-- (em appointments e em schedule_exceptions) além da tabela. O código do bot
-- só escreve `appointments.evento_id` quando encontra um evento — ou seja,
-- quando a tabela `eventos` existe. Se esta migration não rodar inteira, o
-- agendamento continua funcionando sem a marcação; não há meia aplicação que
-- quebre o insert.
-- ============================================================================

CREATE TABLE IF NOT EXISTS eventos (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome         text        NOT NULL DEFAULT 'Feirão',
  data_inicio  date        NOT NULL,
  data_fim     date        NOT NULL,
  -- Horário do evento. Guardado aqui, e não no código, porque cada feirão
  -- estica diferente — a loja muda sem deploy.
  hora_inicio  text        NOT NULL DEFAULT '09:00',
  hora_fim     text        NOT NULL DEFAULT '21:00',
  -- Texto livre, escrito pela LOJA. O bot repete o que está aqui e tem ordem
  -- expressa de não inventar nada além disto (taxa, desconto, parcela).
  condicoes    text,
  ativo        boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eventos_datas_ok CHECK (data_fim >= data_inicio)
);

ALTER TABLE eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eventos_select"       ON eventos;
DROP POLICY IF EXISTS "eventos_insert"       ON eventos;
DROP POLICY IF EXISTS "eventos_update"       ON eventos;
DROP POLICY IF EXISTS "eventos_delete"       ON eventos;
DROP POLICY IF EXISTS "eventos_service_role" ON eventos;

CREATE POLICY "eventos_select"       ON eventos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "eventos_insert"       ON eventos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "eventos_update"       ON eventos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "eventos_delete"       ON eventos FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "eventos_service_role" ON eventos FOR ALL    USING (auth.role() = 'service_role');

-- O bot busca "o evento vigente desta loja": filtra por user_id + ativo e
-- ordena por data_inicio.
CREATE INDEX IF NOT EXISTS eventos_user_periodo_idx
  ON eventos (user_id, ativo, data_fim);

-- ── appointments.evento_id ──────────────────────────────────────────────────
--
-- A visita guarda o evento em que FOI MARCADA, em vez de ser reclassificada
-- pela data na hora de exibir. Se a loja esticar o feirão para o dia 30, quem
-- marcou para o dia 25 não vira visita de feirão retroativamente — e quem
-- marcou durante o feirão não deixa de ser se as datas mudarem depois.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS evento_id uuid REFERENCES eventos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS appointments_user_evento_idx
  ON appointments (user_id, evento_id);

-- ── schedule_exceptions.evento_id ───────────────────────────────────────────
--
-- Abrir a loja nos dias do feirão (inclusive domingo, que a DSC não abre) já
-- tem mecanismo: uma exceção de agenda com closed = false sobrepõe o horário
-- semanal inteiro. Então o feirão não precisa de lógica nova de
-- disponibilidade — precisa gravar as exceções.
--
-- O vínculo existe para a REMOÇÃO ser exata: apagar o evento apaga as exceções
-- que ELE criou, e não um feriado que o lojista marcou à mão.
ALTER TABLE schedule_exceptions
  ADD COLUMN IF NOT EXISTS evento_id uuid REFERENCES eventos(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS schedule_exceptions_evento_idx
  ON schedule_exceptions (evento_id);

-- updated_at
CREATE OR REPLACE FUNCTION eventos_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS eventos_touch ON eventos;
CREATE TRIGGER eventos_touch
  BEFORE UPDATE ON eventos
  FOR EACH ROW EXECUTE FUNCTION eventos_touch_updated_at();
