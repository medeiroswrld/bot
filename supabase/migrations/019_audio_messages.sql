-- 019_audio_messages.sql
-- Marca mensagens que chegaram como áudio e foram transcritas (Whisper).
-- Usado pela UI (ícone de microfone na conversa) e para registrar histórico
-- mesmo quando a transcrição falha (content = "[áudio com falha de transcrição]").
-- Idempotente.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS transcribed_from_audio boolean DEFAULT false;
