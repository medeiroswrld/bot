-- ============================================================================
-- 119 — Comunidade da loja (grupo do WhatsApp, canal, ou qualquer link)
-- ============================================================================
--
-- A loja cria um grupo ou canal fora do sistema e cola o link aqui. O bot
-- convida o cliente em três momentos (depois de agendar, na despedida, e
-- quando o carro procurado não existe no estoque).
--
-- POR QUE UM LINK GENÉRICO E NÃO "grupo_whatsapp_url":
-- o número da loja está na Cloud API e NÃO entra em grupo comum. O caminho
-- oficial da Meta (Groups API) exige Official Business Account e limita o
-- grupo a 8 participantes — inútil aqui. Ou seja: o grupo/canal vive FORA do
-- sistema, num celular da loja, e nós só mandamos o convite. Como a loja pode
-- escolher grupo, canal ou até uma página, o campo é um link qualquer e ela
-- escreve como quer que a gente chame aquilo.
--
-- Idempotente: pode ser reexecutada sem erro.
-- ============================================================================

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS link_comunidade      text,
  ADD COLUMN IF NOT EXISTS link_comunidade_nome text;

COMMENT ON COLUMN company_settings.link_comunidade IS
  'URL do grupo/canal de ofertas da loja. Vazio = o bot nunca menciona.';
COMMENT ON COLUMN company_settings.link_comunidade_nome IS
  'Como a loja chama aquilo ("nosso canal de ofertas"). Entra na frase do bot.';

-- ── Convites já enviados ────────────────────────────────────────────────────
--
-- Existe para o cliente NÃO receber o convite duas vezes. Poderia ser uma
-- instrução no prompt, mas prompt esquece: numa conversa nova o modelo não faz
-- ideia do que mandou semana passada. Aqui a garantia é do banco.
CREATE TABLE IF NOT EXISTS comunidade_convites (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telefone   text        NOT NULL,
  enviado_em timestamptz NOT NULL DEFAULT now()
);

-- A unicidade é por DÍGITOS, não pelo texto cru: o mesmo cliente chega como
-- "+55 15 99999-8888" e como "5515999998888" dependendo da origem, e duas
-- grafias do mesmo número furariam um UNIQUE comum. Normalizar no índice, e
-- não só no código, faz a garantia valer mesmo pra quem inserir direto no
-- banco daqui a seis meses sem lembrar desta regra.
CREATE UNIQUE INDEX IF NOT EXISTS comunidade_convites_unico
  ON comunidade_convites (user_id, regexp_replace(telefone, '\D', '', 'g'));

ALTER TABLE comunidade_convites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comunidade_convites_select"       ON comunidade_convites;
DROP POLICY IF EXISTS "comunidade_convites_service_role" ON comunidade_convites;

CREATE POLICY "comunidade_convites_select"
  ON comunidade_convites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "comunidade_convites_service_role"
  ON comunidade_convites FOR ALL    USING (auth.role() = 'service_role');
