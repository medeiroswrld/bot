-- ============================================================================
-- 013_last_handled_msg_id.sql
-- Coluna usada pelo lock atômico de debounce em process-conversation.
--
-- O código (process-conversation/index.ts) faz um "claim" atômico nesta coluna
-- para garantir que só UMA invocação processe cada lote de mensagens do cliente
-- quando ele manda várias mensagens quase juntas. Sem a coluna, o UPDATE falha,
-- o claim é ignorado e o lock fica desativado (apenas o debounce de 4s atua).
--
-- Idempotente: pode ser reexecutada sem erro.
-- ============================================================================

alter table public.conversations
  add column if not exists last_handled_msg_id text;

comment on column public.conversations.last_handled_msg_id is
  'ID da última mensagem de cliente já assumida por uma invocação do bot (lock de debounce em process-conversation).';
