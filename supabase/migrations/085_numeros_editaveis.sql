-- 085 — o lojista pode rotular os próprios números, e só isso
--
-- A 083 criou `whatsapp_numbers` com policy só de leitura, porque quem conecta
-- número é o Embedded Signup (service_role), não o lojista digitando id.
--
-- Mas rotular ("Vendas", "Rodrigo", "Loja Centro") é decisão da loja, e passar
-- isso por uma edge function seria burocracia pra editar um texto.
--
-- ── Por que policy de update NÃO basta ─────────────────────────────────────
--
-- RLS é por LINHA, não por coluna. Uma policy de update deixaria a loja mexer
-- em qualquer campo da própria linha — inclusive `phone_number_id`, que é a
-- chave de roteamento do webhook. Trocar aquele valor pelo número de outra
-- loja redirecionaria as mensagens dela pra cá.
--
-- É a mesma brecha que a 070 fechou em company_settings, e a resposta é a
-- mesma: policy libera a linha, trigger protege as colunas.

drop policy if exists whatsapp_numbers_update_own on public.whatsapp_numbers;
create policy whatsapp_numbers_update_own on public.whatsapp_numbers
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.protege_campos_do_numero()
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
  -- Só barra quem chega pela API como usuário logado. O Embedded Signup usa
  -- service_role e passa; SQL direto (migrations, painel) também.
  if papel not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.phone_number_id is distinct from old.phone_number_id
     or new.user_id is distinct from old.user_id
     or new.waba_id is distinct from old.waba_id then
    raise exception 'Identificadores do número são definidos na conexão com a Meta, não podem ser editados.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protege_numero on public.whatsapp_numbers;
create trigger trg_protege_numero
  before update on public.whatsapp_numbers
  for each row
  execute function public.protege_campos_do_numero();

-- ── Trocar o principal com um clique ────────────────────────────────────────
--
-- Existe índice único garantindo um principal por loja (083). Sem este gatilho,
-- marcar o segundo número como principal daria erro de violação de índice — e
-- o lojista veria uma mensagem de banco em vez de a coisa simplesmente
-- funcionar. Aqui, marcar um desmarca o anterior.
create or replace function public.um_principal_por_loja()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.principal then
    update public.whatsapp_numbers
       set principal = false
     where user_id = new.user_id
       and id <> new.id
       and principal;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_um_principal on public.whatsapp_numbers;
create trigger trg_um_principal
  before insert or update of principal on public.whatsapp_numbers
  for each row
  when (new.principal)
  execute function public.um_principal_por_loja();
