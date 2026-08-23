-- 066 — registro de cada tentativa de push
--
-- Existe porque a investigação do push travou num ponto cego: o teste disparado
-- do navegador chegava, o disparo do webhook não, e a única forma de saber o
-- porquê era abrir o log da edge function — o que na prática significa pedir
-- para o usuário caçar linha em painel, uma vez por hipótese.
--
-- Gravando aqui, a resposta fica dentro do próprio CRM: dá para ver se o
-- webhook chamou, para qual conta mirou e quantos aparelhos receberam. Sem
-- isso, "não chegou" é indistinguível de "nem foi tentado".
--
-- Some sozinho: 7 dias bastam para diagnosticar e isto não é dado de negócio.

create table if not exists public.push_log (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        references auth.users(id) on delete cascade,
  origem     text,        -- 'webhook' (service_role) ou 'app' (usuário)
  enviados   int         not null default 0,
  total      int         not null default 0,
  detalhe    text,
  created_at timestamptz not null default now()
);

create index if not exists push_log_user_idx
  on public.push_log (user_id, created_at desc);

alter table public.push_log enable row level security;

drop policy if exists "push log proprio" on public.push_log;
create policy "push log proprio" on public.push_log
  for select using (auth.uid() = user_id);

comment on table public.push_log is
  'Últimas tentativas de notificação. Diagnóstico: separa "não foi tentado" de "foi tentado e falhou".';
