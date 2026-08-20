-- 056 — Configuração de Instagram e Messenger
--
-- Complementa a 037 (que criou `conversations.channel`). Aqui entram os IDs da
-- página e da conta do Instagram, e o token da página, cifrado no Vault.
--
-- NOTA sobre `customer_phone`: no Instagram e no Messenger ele guarda o
-- identificador do usuário (PSID/IGSID), não um telefone — esses canais não
-- expõem telefone. O nome da coluna passou a mentir, mas trocá-lo obrigaria a
-- mexer na chave da tabela de conversas e em toda a resolução de conversa, que
-- é o caminho mais crítico do sistema. A unicidade é (user_id, channel,
-- customer_phone), então não há colisão entre canais.

alter table public.company_settings
  add column if not exists fb_page_id      text,
  add column if not exists ig_user_id      text,
  add column if not exists meta_token_set  boolean not null default false;

comment on column public.company_settings.fb_page_id is
  'ID da página do Facebook. Roteia o webhook do Messenger e é o remetente das respostas.';
comment on column public.company_settings.ig_user_id is
  'ID da conta comercial do Instagram ligada à página. Roteia o webhook do Instagram.';

-- Índices de roteamento: o webhook chega com o ID e precisa achar a loja. Sem
-- eles cada mensagem varreria a tabela inteira.
create index if not exists idx_settings_fb_page on public.company_settings (fb_page_id)
  where fb_page_id is not null;
create index if not exists idx_settings_ig_user on public.company_settings (ig_user_id)
  where ig_user_id is not null;

-- ── Token da página no Vault ─────────────────────────────────────────────────
-- Mesmo desenho do token do WhatsApp (015): nome determinístico por tenant, sem
-- ponteiro editável, e só service_role executa. Token de página dá acesso a
-- responder como a marca — não pode ficar em tabela comum.
create or replace function public.set_meta_page_token(p_user_id uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_name text := 'meta_page_token_' || p_user_id::text;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    delete from vault.secrets where name = v_name;
    update public.company_settings set meta_token_set = false, updated_at = now()
      where user_id = p_user_id;
    return;
  end if;

  select s.id into v_secret_id from vault.secrets s where s.name = v_name;
  if v_secret_id is null then
    perform vault.create_secret(p_token, v_name, 'Token de pagina Meta (tenant ' || p_user_id::text || ')');
  else
    perform vault.update_secret(v_secret_id, p_token);
  end if;

  update public.company_settings set meta_token_set = true, updated_at = now()
    where user_id = p_user_id;
end;
$$;

create or replace function public.get_meta_page_token(p_user_id uuid)
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
  where ds.name = 'meta_page_token_' || p_user_id::text;
  return v_token;
end;
$$;

revoke all on function public.set_meta_page_token(uuid, text) from public, anon, authenticated;
revoke all on function public.get_meta_page_token(uuid)        from public, anon, authenticated;
grant  execute on function public.set_meta_page_token(uuid, text) to service_role;
grant  execute on function public.get_meta_page_token(uuid)        to service_role;
