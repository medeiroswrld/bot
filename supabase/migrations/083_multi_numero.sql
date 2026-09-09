-- 083 — vários números de WhatsApp na mesma loja
--
-- A Leadrinho Motos tem três números. Hoje o sistema aguenta um só, porque
-- `company_settings.whatsapp_phone_number_id` não é um dado da loja: é a CHAVE
-- DE ROTEAMENTO. O webhook faz `.eq('whatsapp_phone_number_id', ...)` pra
-- descobrir de quem é a mensagem que chegou.
--
-- A saída de hoje seria criar uma conta por número — e aí estoque, leads e
-- financeiro ficam partidos em três, que é pior do que o problema.
--
-- ── A parte mais perigosa, e como ela é contornada ──────────────────────────
--
-- Seis funções leem `company_settings.whatsapp_phone_number_id`:
-- check-pending-schedules, notify-waiting-list-match, send-agent-message,
-- process-conversation (duas vezes), conectar-whatsapp e as views de cobrança
-- do admin.
--
-- Mexer nas seis de uma vez, no caminho por onde entra toda mensagem de
-- cliente, é como se erra feio. Então a coluna antiga CONTINUA existindo e
-- passa a ser espelho do número principal, mantida por trigger. Nada que já
-- funciona precisa mudar pra esta migration ser segura.
--
-- ── A segunda armadilha: conversa não sabia por qual número entrou ──────────
--
-- A chave única era (user_id, channel, customer_phone). Com dois números, o
-- mesmo cliente falando com os dois colidia numa conversa só — e a resposta
-- podia sair pelo número errado, que é confuso pro cliente e embaralha o
-- histórico. Por isso o número entra na chave.

-- ── 1. Os números da loja ───────────────────────────────────────────────────
create table if not exists public.whatsapp_numbers (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,

  -- Id da Cloud API. É único no mundo inteiro na Meta, e é por ele que o
  -- webhook roteia — por isso `unique` global e não por loja: dois lojistas não
  -- podem reivindicar o mesmo número.
  phone_number_id text not null unique,

  waba_id         text,
  numero          text,   -- como aparece pra humano: +55 15 3271-0164
  rotulo          text,   -- "Vendas", "Rodrigo", "Loja Centro"
  principal       boolean not null default false,
  ativo           boolean not null default true,
  created_at      timestamptz not null default now()
);

comment on table public.whatsapp_numbers is
  'Números de WhatsApp de cada loja. phone_number_id é a chave de roteamento do webhook.';
comment on column public.whatsapp_numbers.principal is
  'O número padrão da loja. Espelhado em company_settings.whatsapp_phone_number_id por trigger, pra tudo que ainda lê de lá continuar funcionando.';

-- Um principal por loja. Sem isto, dois principais fariam o espelho oscilar.
create unique index if not exists whatsapp_numbers_principal_uniq
  on public.whatsapp_numbers (user_id)
  where principal;

create index if not exists whatsapp_numbers_user_idx
  on public.whatsapp_numbers (user_id)
  where ativo;

alter table public.whatsapp_numbers enable row level security;

drop policy if exists whatsapp_numbers_select_own on public.whatsapp_numbers;
create policy whatsapp_numbers_select_own on public.whatsapp_numbers
  for select using (auth.uid() = user_id);

-- Escrita só pelo service_role: quem conecta número é o fluxo do Embedded
-- Signup, não o lojista digitando um id na tela.

-- ── 2. Trazer o que já existe ───────────────────────────────────────────────
insert into public.whatsapp_numbers (user_id, phone_number_id, waba_id, numero, rotulo, principal)
select cs.user_id,
       cs.whatsapp_phone_number_id,
       cs.whatsapp_business_account_id,
       nullif(cs.whatsapp_number, ''),
       'Principal',
       true
  from public.company_settings cs
 where coalesce(cs.whatsapp_phone_number_id, '') <> ''
on conflict (phone_number_id) do nothing;

-- ── 3. Espelho, pra não quebrar as seis funções ─────────────────────────────
create or replace function public.espelha_numero_principal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_pid  text;
begin
  select n.phone_number_id into v_pid
    from public.whatsapp_numbers n
   where n.user_id = v_user and n.principal and n.ativo
   limit 1;

  update public.company_settings
     set whatsapp_phone_number_id = v_pid
   where user_id = v_user
     and whatsapp_phone_number_id is distinct from v_pid;

  return null;
end;
$$;

drop trigger if exists trg_espelha_numero on public.whatsapp_numbers;
create trigger trg_espelha_numero
  after insert or update or delete on public.whatsapp_numbers
  for each row
  execute function public.espelha_numero_principal();

-- ── 4. A conversa passa a saber por qual número entrou ──────────────────────
alter table public.conversations
  add column if not exists phone_number_id text;

comment on column public.conversations.phone_number_id is
  'Qual número NOSSO recebeu esta conversa. Define por onde a resposta sai.';

-- Conversa antiga é do número principal da loja — era o único que existia.
update public.conversations c
   set phone_number_id = cs.whatsapp_phone_number_id
  from public.company_settings cs
 where cs.user_id = c.user_id
   and c.phone_number_id is null
   and c.channel = 'whatsapp'
   and coalesce(cs.whatsapp_phone_number_id, '') <> '';

-- ── 5. Trocar a chave única ─────────────────────────────────────────────────
--
-- Só depois do preenchimento acima: com phone_number_id nulo, linhas
-- diferentes não colidiriam e a troca passaria dando a impressão de ter
-- funcionado, deixando o defeito pra aparecer no primeiro cliente que falasse
-- com dois números.
--
-- Canal social continua com phone_number_id nulo, e isso é correto: lá o
-- roteamento é por conta do Instagram/Página, não por número.
alter table public.conversations
  drop constraint if exists conversations_user_channel_phone_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conversations_user_channel_phone_numero_key'
  ) then
    alter table public.conversations
      add constraint conversations_user_channel_phone_numero_key
      unique nulls not distinct (user_id, channel, customer_phone, phone_number_id);
  end if;
end $$;

create index if not exists conversations_numero_idx
  on public.conversations (user_id, phone_number_id)
  where phone_number_id is not null;
