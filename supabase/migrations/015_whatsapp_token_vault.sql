-- ============================================================================
-- 015_whatsapp_token_vault.sql
-- ETAPA 1 (multi-tenant real): token do WhatsApp por tenant, CIFRADO no Supabase
-- Vault. O token nunca fica em texto puro numa tabela normal nem é exposto ao
-- frontend.
--
-- Modelo:
--  - O token cifrado vive em vault.secrets (schema vault, fora do PostgREST,
--    sem privilégio para anon/authenticated).
--  - Cada tenant tem um secret com nome determinístico 'whatsapp_token_<user_id>'
--    (sem ponteiro editável pelo tenant → ninguém aponta para o secret de outro).
--  - company_settings guarda só uma flag NÃO sensível (whatsapp_token_set) para
--    a UI mostrar "token cadastrado ✓".
--  - set_whatsapp_token(): cifra/atualiza/remove (chamada por Edge Function via
--    service_role). get_whatsapp_token(): decifra (só service_role); retorna NULL
--    se o tenant não tem token próprio → o caller cai no fallback global
--    WHATSAPP_TOKEN.
--
-- Idempotente.
-- ============================================================================

-- Vault (no Supabase hosted já vem habilitado; rede de segurança)
create extension if not exists supabase_vault with schema vault cascade;

-- Flag NÃO sensível: indica se o tenant tem token próprio cadastrado (UI mostra "✓").
alter table public.company_settings
  add column if not exists whatsapp_token_set boolean not null default false;

comment on column public.company_settings.whatsapp_token_set is
  'true se o tenant tem token de WhatsApp proprio (cifrado no Vault). Flag cosmetica; o token NUNCA fica aqui.';

-- GRAVAR / atualizar / remover o token (cifra no Vault). SECURITY DEFINER, só service_role.
create or replace function public.set_whatsapp_token(p_user_id uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_name text := 'whatsapp_token_' || p_user_id::text;
begin
  -- token vazio → remove o secret (tenant volta pro fallback global)
  if p_token is null or length(btrim(p_token)) = 0 then
    delete from vault.secrets where name = v_name;
    update public.company_settings set whatsapp_token_set = false, updated_at = now()
      where user_id = p_user_id;
    return;
  end if;

  select s.id into v_secret_id from vault.secrets s where s.name = v_name;
  if v_secret_id is null then
    perform vault.create_secret(p_token, v_name, 'WhatsApp token (tenant ' || p_user_id::text || ')');
  else
    perform vault.update_secret(v_secret_id, p_token);
  end if;

  update public.company_settings set whatsapp_token_set = true, updated_at = now()
    where user_id = p_user_id;
end;
$$;

-- LER o token decifrado. SECURITY DEFINER, só service_role. NULL se não houver token próprio.
create or replace function public.get_whatsapp_token(p_user_id uuid)
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
  where ds.name = 'whatsapp_token_' || p_user_id::text;
  return v_token;
end;
$$;

-- Permissões: NUNCA anon/authenticated. Só service_role (Edge Functions).
revoke all on function public.set_whatsapp_token(uuid, text) from public, anon, authenticated;
revoke all on function public.get_whatsapp_token(uuid)        from public, anon, authenticated;
grant  execute on function public.set_whatsapp_token(uuid, text) to service_role;
grant  execute on function public.get_whatsapp_token(uuid)        to service_role;
