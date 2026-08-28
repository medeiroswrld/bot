-- 071 — terceiro nível de plano: disparos
--
-- Três combinações que a venda pede:
--   CRM sozinho
--   CRM + disparos (campanha, aniversário, template)
--   CRM + disparos + bot
--
-- Duas colunas independentes em vez de um campo "plano" com três valores. O
-- motivo é prático: um dia vai aparecer alguém querendo bot sem campanha, e
-- enum de plano obriga a criar mais um valor e reescrever toda checagem. Dois
-- booleanos combinam sozinhos.
--
-- Protegida pelo mesmo trigger da 070 — sem isso o lojista se libera com uma
-- requisição, porque a RLS do company_settings é por linha e não por coluna.

alter table public.company_settings
  add column if not exists disparos_contratado boolean not null default false;

comment on column public.company_settings.disparos_contratado is
  'Se o plano inclui envio em massa (campanhas, aniversário, templates). Definido só pelo administrador.';

-- Quem já dispara continua disparando: ter campanha criada é a evidência de
-- que o serviço está em uso hoje.
update public.company_settings cs
   set disparos_contratado = true
 where disparos_contratado = false
   and (
     cs.bot_contratado = true
     or exists (select 1 from public.campaigns c where c.user_id = cs.user_id)
   );

-- ── Trigger: inclui a coluna nova na proteção ───────────────────────────────
create or replace function public.protege_campos_do_plano()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  papel text := coalesce(
    current_setting('request.jwt.claims', true)::json ->> 'role',
    ''
  );
begin
  -- Bloqueia SÓ quem chega pela API como usuário logado. O painel do
  -- administrador usa service_role e passa; acesso direto ao banco (SQL editor,
  -- migrations) não tem claims e também passa.
  if papel not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.bot_contratado is distinct from old.bot_contratado then
    raise exception 'O plano é definido pelo administrador do sistema.';
  end if;

  if new.disparos_contratado is distinct from old.disparos_contratado then
    raise exception 'O plano é definido pelo administrador do sistema.';
  end if;

  if new.suspenso is distinct from old.suspenso then
    raise exception 'A suspensão é definida pelo administrador do sistema.';
  end if;

  return new;
end;
$$;
