-- 070 — plano sem bot, e a trava que faltava
--
-- Passa a existir cliente que compra só o CRM. O bot precisa ser uma coisa que
-- o administrador libera, não uma que o lojista liga sozinho.
--
-- ── O furo que isto fecha ───────────────────────────────────────────────────
--
-- A RLS do company_settings permite ao lojista dar UPDATE na própria linha, e
-- RLS é por LINHA, não por coluna. Ou seja: hoje ele consegue alterar qualquer
-- campo pela API, inclusive `suspenso` — o corte por inadimplência. Um cliente
-- que saiba mexer se reativa sozinho, e ninguém fica sabendo.
--
-- Esconder o botão na tela não resolve nada: a tela não é a fronteira, a API é.
-- Por isso a proteção é um trigger no banco.

alter table public.company_settings
  add column if not exists bot_contratado boolean not null default false;

comment on column public.company_settings.bot_contratado is
  'Se o plano da loja inclui o bot. Definido SÓ pelo administrador — protegido por trigger.';

-- Quem já usa o bot continua usando: ter número de WhatsApp configurado é a
-- evidência de que o serviço está contratado hoje.
update public.company_settings
   set bot_contratado = true
 where whatsapp_phone_number_id is not null
   and bot_contratado = false;

-- ── Trigger: colunas que o lojista não pode tocar ───────────────────────────
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

  if new.suspenso is distinct from old.suspenso then
    raise exception 'A suspensão é definida pelo administrador do sistema.';
  end if;

  return new;
end;
$$;

drop trigger if exists protege_plano on public.company_settings;
create trigger protege_plano
  before update on public.company_settings
  for each row
  execute function public.protege_campos_do_plano();
