-- 037 — Canal da conversa (WhatsApp / Instagram / Messenger)
--
-- Preparação para atender DM de Instagram e Messenger. Nada passa a funcionar
-- com esta migração: ela só abre espaço no modelo pra quando a integração com a
-- Meta for aprovada. Toda conversa existente vira 'whatsapp' pelo default, e o
-- fluxo atual segue idêntico.
--
-- SOBRE `customer_phone`: passa a significar "identificador do cliente NAQUELE
-- canal" — telefone no WhatsApp, IGSID no Instagram, PSID no Messenger. Manter
-- uma coluna só (em vez de phone + external_id) evita redundância e mantém
-- todos os índices e consultas atuais valendo. O `channel` é quem diz como ler
-- o campo.
--
-- A UNICIDADE precisa incluir o canal: a mesma pessoa pode falar pelo Instagram
-- e depois pelo WhatsApp, e são duas conversas distintas de propósito — o
-- lojista precisa ver de onde veio cada contato.

alter table public.conversations
  add column if not exists channel text not null default 'whatsapp';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conversations_channel_check'
  ) then
    alter table public.conversations
      add constraint conversations_channel_check
      check (channel in ('whatsapp', 'instagram', 'messenger'));
  end if;
end $$;

-- Troca (user_id, customer_phone) por (user_id, channel, customer_phone).
alter table public.conversations
  drop constraint if exists conversations_user_id_customer_phone_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conversations_user_channel_phone_key'
  ) then
    alter table public.conversations
      add constraint conversations_user_channel_phone_key
      unique (user_id, channel, customer_phone);
  end if;
end $$;

create index if not exists idx_conversations_channel
  on public.conversations (user_id, channel);
