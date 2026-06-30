-- 029_realtime_conversations_messages.sql
-- Problema B: o Realtime não dispara pra Conversas/Mensagens porque as tabelas
-- nunca entraram na publicação supabase_realtime (a 002 criou conversations/
-- messages mas não publicou). Sem isso, o postgres_changes do Conversations.tsx
-- nunca recebe evento → o usuário precisa dar F5.
--
-- Adiciona as duas à publicação (idempotente: só adiciona se ainda não estiver)
-- + REPLICA IDENTITY FULL pra que os eventos de UPDATE venham com a linha
-- completa (a tela usa UPDATE de mensagem — ex.: transcrição de áudio, status).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

-- REPLICA IDENTITY FULL é idempotente (pode rodar de novo sem erro).
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.messages      REPLICA IDENTITY FULL;
