-- ============================================================================
-- 002_whatsapp_bot.sql
-- Suporte ao bot de WhatsApp: conversations, messages e novos campos em
-- company_settings. Idempotente: pode ser reexecutado sem erro.
-- ============================================================================

-- ============================================================================
-- SEÇÃO 1: TABELA conversations
-- ============================================================================

create table if not exists public.conversations (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references public.profiles(id) on delete cascade,
  customer_phone   text        not null,
  customer_name    text,
  status           text        not null default 'bot'
                                check (status in ('bot', 'human', 'closed')),
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),

  unique (user_id, customer_phone)
);

comment on table public.conversations is
  'Uma conversa por cliente (telefone) por concessionária.';

-- ============================================================================
-- SEÇÃO 2: TABELA messages
-- ============================================================================

create table if not exists public.messages (
  id               uuid        primary key default gen_random_uuid(),
  conversation_id  uuid        not null references public.conversations(id) on delete cascade,
  role             text        not null
                                check (role in ('customer', 'bot', 'agent')),
  content          text        not null,
  wa_message_id    text        unique,   -- NULL para mensagens enviadas pelo bot/agente
  created_at       timestamptz not null default now()
);

comment on table public.messages is
  'Cada mensagem trocada numa conversa. Memória do bot.';

-- ============================================================================
-- SEÇÃO 3: NOVAS COLUNAS EM company_settings
-- ============================================================================

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'company_settings'
      and column_name  = 'whatsapp_phone_number_id'
  ) then
    alter table public.company_settings
      add column whatsapp_phone_number_id text;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'company_settings'
      and column_name  = 'booking_mode'
  ) then
    alter table public.company_settings
      add column booking_mode text not null default 'auto'
        check (booking_mode in ('auto', 'confirm'));
  end if;
end $$;

-- ============================================================================
-- SEÇÃO 4: ÍNDICES
-- ============================================================================

create index if not exists conversations_customer_phone_idx
  on public.conversations(customer_phone);

create index if not exists messages_conversation_created_idx
  on public.messages(conversation_id, created_at);

-- Índice único para wa_message_id (ignora NULLs automaticamente no Postgres)
create unique index if not exists messages_wa_message_id_unique
  on public.messages(wa_message_id)
  where wa_message_id is not null;

-- ============================================================================
-- SEÇÃO 5: RLS — conversations
-- ============================================================================

alter table public.conversations enable row level security;

drop policy if exists "conversations_select_own"    on public.conversations;
drop policy if exists "conversations_insert_own"    on public.conversations;
drop policy if exists "conversations_update_own"    on public.conversations;
drop policy if exists "conversations_delete_own"    on public.conversations;
drop policy if exists "conversations_service_role"  on public.conversations;

create policy "conversations_select_own"
  on public.conversations for select
  using (user_id = auth.uid());

create policy "conversations_insert_own"
  on public.conversations for insert
  with check (user_id = auth.uid());

create policy "conversations_update_own"
  on public.conversations for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "conversations_delete_own"
  on public.conversations for delete
  using (user_id = auth.uid());

create policy "conversations_service_role"
  on public.conversations for all
  to service_role
  using (true)
  with check (true);

-- ============================================================================
-- SEÇÃO 6: RLS — messages
-- ============================================================================

alter table public.messages enable row level security;

drop policy if exists "messages_select_own"    on public.messages;
drop policy if exists "messages_insert_own"    on public.messages;
drop policy if exists "messages_update_own"    on public.messages;
drop policy if exists "messages_service_role"  on public.messages;

create policy "messages_select_own"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "messages_insert_own"
  on public.messages for insert
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "messages_update_own"
  on public.messages for update
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "messages_service_role"
  on public.messages for all
  to service_role
  using (true)
  with check (true);

-- ============================================================================
-- SEÇÃO 7: QUERIES DE VERIFICAÇÃO (retornam zero linhas se tudo certo)
-- ============================================================================

-- 7a. Tabelas novas com RLS DESLIGADO (deve ser vazio)
select tablename from pg_tables
where schemaname = 'public'
  and tablename in ('conversations', 'messages')
  and rowsecurity = false;

-- 7b. Colunas adicionadas a company_settings
select column_name from information_schema.columns
where table_schema = 'public'
  and table_name   = 'company_settings'
  and column_name  in ('whatsapp_phone_number_id', 'booking_mode');
