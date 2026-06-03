-- 006_pending_status.sql
-- Adiciona 'pending' como valor válido para conversations.status.
-- Se a coluna tiver CHECK constraint, atualiza. Se for text livre, é no-op seguro.

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_status_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('bot', 'human', 'closed', 'pending'));
