-- 046 — Inscrições de push (notificação no celular)
--
-- A API Notification que o CRM já usava só dispara com a aba aberta — ou seja,
-- só quando o lojista já está olhando a tela e não precisa ser avisado. Web
-- Push entrega com o app fechado, e para isso o servidor precisa guardar a
-- inscrição de cada aparelho.
--
-- Um usuário tem VÁRIAS linhas: celular, tablet, desktop. Cada aparelho gera um
-- endpoint próprio.
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- URL que o navegador dá pra entregar o push. Única: reinscrever no mesmo
  -- aparelho atualiza em vez de criar linha duplicada e notificar duas vezes.
  endpoint   text not null unique,
  p256dh     text not null,   -- chave pública do aparelho (cifra o payload)
  auth       text not null,   -- segredo de autenticação do aparelho
  user_agent text,            -- só pra o lojista reconhecer qual aparelho é
  created_at timestamptz not null default now()
);

-- O envio busca sempre por user_id (todas as inscrições daquela loja).
create index if not exists idx_push_subs_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push subs proprias" on public.push_subscriptions;

-- Cada um só enxerga e mexe nas próprias inscrições. O envio é feito pela
-- service_role, que ignora RLS.
create policy "push subs proprias" on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
