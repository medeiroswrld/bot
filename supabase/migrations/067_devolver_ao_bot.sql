-- 067 — devolver a conversa ao bot quando o atendente some
--
-- O atendente assume, responde uma ou duas vezes e a vida acontece: cliente na
-- loja, almoço, fim do expediente. A conversa fica travada em "humano" para
-- sempre e o cliente do outro lado não recebe mais nada — sem que ninguém
-- perceba, porque nada quebrou.
--
-- É o pior tipo de falha do produto: o bot funcionando, o lojista pagando, e o
-- lead morrendo em silêncio.
--
-- Desligado por padrão. Loja com equipe grande pode preferir que a conversa
-- espere um humano de verdade, e assumir esse comportamento pelo cliente seria
-- o bot atropelando um atendimento em andamento.

alter table public.company_settings
  add column if not exists auto_return_enabled boolean not null default false,
  add column if not exists auto_return_minutes smallint not null default 15;

comment on column public.company_settings.auto_return_minutes is
  'Minutos de silêncio na conversa antes de devolvê-la ao bot. Conta a partir da ÚLTIMA mensagem, de quem quer que seja.';

-- Índice para a varredura do cron: só conversas em atendimento humano
-- interessam, e são poucas.
create index if not exists conversations_humano_idx
  on public.conversations (user_id, last_message_at)
  where status = 'human';

-- ── Cron: a cada 5 minutos ───────────────────────────────────────────────────
-- Rodar DEPOIS do deploy da function `devolver-ao-bot` (com --no-verify-jwt).
--
-- 5 minutos e nao 1: a granularidade que o lojista percebe e "uns 15 minutos",
-- e varrer a cada minuto seria 5x mais execucao pra ganhar precisao que ninguem
-- nota.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('devolver-ao-bot-5min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'devolver-ao-bot-5min');

SELECT cron.schedule(
  'devolver-ao-bot-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://silmopooaspcpyquhmsw.supabase.co/functions/v1/devolver-ao-bot',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);
