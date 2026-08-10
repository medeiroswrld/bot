-- 035 — Marcar qual mensagem veio de campanha
--
-- Hoje o disparo entra na conversa como mensagem comum do bot, indistinguível
-- do que o assistente escreveu. Quem abre a conversa não sabe se aquele "Oi
-- Jose, faz um tempo que a gente não se fala" foi a IA ou um disparo em massa —
-- e isso muda completamente como o vendedor continua o papo.
--
-- Guardamos a referência à campanha em vez de um rótulo de texto: assim o nome
-- e o template vêm sempre atualizados, e dá pra navegar da conversa pra
-- campanha depois. ON DELETE SET NULL porque apagar a campanha não pode apagar
-- o histórico da conversa com o cliente.

alter table public.messages
  add column if not exists campaign_id uuid
  references public.campaigns(id) on delete set null;

create index if not exists idx_messages_campaign
  on public.messages (campaign_id)
  where campaign_id is not null;
