-- 060 — token do feed público de estoque
--
-- Um endereço por loja, para o site dela ler o estoque ao vivo. Sem
-- sincronização: o site consulta, e carro vendido some porque a consulta não o
-- traz mais. Não há job, webhook nem fila para desalinhar.
--
-- O token é opaco e revogável de propósito. Não uso o user_id na URL porque ele
-- é o identificador interno da conta e aparece em outros lugares; um token
-- separado pode ser trocado sem tocar em mais nada quando o link vazar.

alter table public.company_settings
  add column if not exists feed_token text;

-- Backfill: toda loja que já existe nasce com um token.
update public.company_settings
   set feed_token = encode(gen_random_bytes(16), 'hex')
 where feed_token is null;

-- Único, e o índice serve também para a busca do webhook, que é sempre por token.
create unique index if not exists company_settings_feed_token_key
  on public.company_settings (feed_token)
  where feed_token is not null;

comment on column public.company_settings.feed_token is
  'Token opaco do feed público de estoque. Regenerar invalida o link antigo.';

-- Regenera o token da própria loja. SECURITY DEFINER porque a coluna não é
-- escrita direto pelo cliente — a troca passa por aqui, e só para a conta de
-- quem chama.
create or replace function public.regerar_feed_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  novo text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  novo := encode(gen_random_bytes(16), 'hex');

  update public.company_settings
     set feed_token = novo
   where user_id = auth.uid();

  if not found then
    raise exception 'Configurações da loja não encontradas';
  end if;

  return novo;
end;
$$;

revoke all on function public.regerar_feed_token() from public, anon;
grant execute on function public.regerar_feed_token() to authenticated;
