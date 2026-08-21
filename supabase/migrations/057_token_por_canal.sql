-- 057 — Um token por canal: Instagram e Messenger conectam separado
--
-- A 056 assumiu um token só, partindo do modelo em que a página cobre os dois
-- canais. Não serve: há loja que usa só o Direct e nunca abre o Messenger, e
-- obrigá-la a conectar uma página seria pedir configuração que ela não usa.
-- Além disso o Instagram pode ser conectado com login próprio, que gera um
-- token dele, não da página.

alter table public.company_settings
  add column if not exists ig_token_set boolean not null default false,
  add column if not exists fb_token_set boolean not null default false;

-- Migra a flag antiga: quem já tinha token valia para os dois.
update public.company_settings
   set ig_token_set = true, fb_token_set = true
 where meta_token_set = true
   and ig_token_set = false
   and fb_token_set = false;

-- As antigas recebiam só o user_id; as novas recebem o canal. Assinaturas
-- diferentes coexistiriam, e um caller desatualizado gravaria no lugar errado
-- sem erro — por isso o drop explícito.
drop function if exists public.set_meta_page_token(uuid, text);
drop function if exists public.get_meta_page_token(uuid);

create or replace function public.set_meta_page_token(p_user_id uuid, p_canal text, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_canal text := lower(btrim(coalesce(p_canal, '')));
  v_name  text;
begin
  if v_canal not in ('instagram', 'messenger') then
    raise exception 'canal inválido: %', p_canal;
  end if;
  v_name := 'meta_token_' || v_canal || '_' || p_user_id::text;

  if p_token is null or length(btrim(p_token)) = 0 then
    delete from vault.secrets where name = v_name;
    if v_canal = 'instagram' then
      update public.company_settings set ig_token_set = false, updated_at = now() where user_id = p_user_id;
    else
      update public.company_settings set fb_token_set = false, updated_at = now() where user_id = p_user_id;
    end if;
    return;
  end if;

  select s.id into v_secret_id from vault.secrets s where s.name = v_name;
  if v_secret_id is null then
    perform vault.create_secret(p_token, v_name, 'Token Meta ' || v_canal || ' (tenant ' || p_user_id::text || ')');
  else
    perform vault.update_secret(v_secret_id, p_token);
  end if;

  if v_canal = 'instagram' then
    update public.company_settings set ig_token_set = true, updated_at = now() where user_id = p_user_id;
  else
    update public.company_settings set fb_token_set = true, updated_at = now() where user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.get_meta_page_token(p_user_id uuid, p_canal text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  select ds.decrypted_secret into v_token
  from vault.decrypted_secrets ds
  where ds.name = 'meta_token_' || lower(btrim(coalesce(p_canal, ''))) || '_' || p_user_id::text;
  return v_token;
end;
$$;

revoke all on function public.set_meta_page_token(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_meta_page_token(uuid, text)       from public, anon, authenticated;
grant  execute on function public.set_meta_page_token(uuid, text, text) to service_role;
grant  execute on function public.get_meta_page_token(uuid, text)       to service_role;
