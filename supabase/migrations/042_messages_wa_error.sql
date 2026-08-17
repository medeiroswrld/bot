-- 042 — Guarda o motivo da falha de envio do WhatsApp
--
-- O evento de status da Meta traz um array `errors` com code + title quando
-- status = failed. Hoje a gente grava só o wa_status e descarta o motivo: o
-- lojista vê um "!" vermelho que não diz nada, e descobrir a causa exige ir no
-- Graph API Explorer. Foi exatamente o que aconteceu na virada da coexistência
-- da DSC em 2026-08-17 — várias rodadas de tentativa e erro para achar o que a
-- Meta já tinha informado no primeiro webhook.
alter table public.messages
  add column if not exists wa_error text;

comment on column public.messages.wa_error is
  'Motivo da falha de envio informado pela Meta (code + title) quando wa_status = failed. NULL nos demais casos.';
