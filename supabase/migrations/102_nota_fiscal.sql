-- 102 — emissão de NF-e
--
-- ── O caminho escolhido, e por que não há outro ────────────────────────────
--
-- NF-e é um XML (layout 4.00) assinado com certificado digital e transmitido à
-- SEFAZ, que devolve protocolo e uma chave de 44 dígitos. O DANFE é só a
-- impressão disso.
--
-- O Amply roda em servidor, então assinar aqui exige certificado **A1**
-- (arquivo). Com **A3** (token físico) é impossível — não por decisão de
-- projeto, mas porque o token precisa estar na máquina que assina. Loja com A3
-- troca o formato na certificadora ou emite por fora.
--
-- Por isso a transmissão vai por provedor de nuvem (Focus NFe e equivalentes):
-- mandamos JSON, eles assinam com o A1 e falam com a SEFAZ. Guardar o
-- certificado aqui seria assumir a guarda de um documento que assina em nome
-- de outra empresa — risco que não se paga.
--
-- ── A série separada é o que torna isto seguro ─────────────────────────────
--
-- A loja que já emite continua na série dela; o Amply emite em outra. As
-- numerações não colidem, e se der errado ela volta a emitir pelo sistema
-- antigo no mesmo dia, sem buraco na sequência. Migração sem ponte queimada.
--
-- ── O que este sistema NÃO decide ──────────────────────────────────────────
--
-- Imposto. CFOP, CST e redução de base vêm preenchidos pelo contador da loja e
-- são enviados como estão. Veículo usado é tributado sobre a MARGEM, e a
-- margem depende do preço de compra — que já existe em `cars.purchase_price`,
-- mas hoje é preenchido em 4 de 33 vendas na Leandrinho e 0 de 16 na DSC.
--
-- Emitir sem isso produz nota com base de cálculo errada. Por isso a emissão
-- EXIGE o preço de compra, e falha dizendo isso, em vez de mandar um número
-- inventado para a SEFAZ.

-- ── Configuração fiscal da loja ────────────────────────────────────────────

alter table public.company_settings
  add column if not exists nf_ativo              boolean not null default false,
  add column if not exists nf_provedor           text,
  add column if not exists nf_ambiente           text not null default 'homologacao',
  add column if not exists nf_serie              integer,
  add column if not exists nf_proximo_numero     integer,
  add column if not exists inscricao_estadual    text,
  add column if not exists nf_regime_tributario  text,
  add column if not exists nf_cfop               text,
  add column if not exists nf_token_set          boolean not null default false;

comment on column public.company_settings.nf_ambiente is
  'homologacao ou producao. Nasce em homologacao de proposito: nota de teste nao vale como documento e nao gera obrigacao.';
comment on column public.company_settings.nf_serie is
  'Serie propria do Amply. Separada da que a loja ja usa, para as numeracoes nao colidirem.';
comment on column public.company_settings.nf_cfop is
  'CFOP definido pelo contador da loja. O sistema NAO escolhe — envia o que foi configurado.';

-- ── O token do provedor vai para o Vault ───────────────────────────────────
-- Mesmo peso dos tokens da Meta: quem tem ele emite documento fiscal em nome
-- da loja.

create or replace function public.set_nf_token(p_user_id uuid, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text := 'nf_token_' || p_user_id::text;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    delete from vault.secrets where name = v_name;
    update public.company_settings set nf_token_set = false, updated_at = now()
      where user_id = p_user_id;
    return;
  end if;
  delete from vault.secrets where name = v_name;
  perform vault.create_secret(p_token, v_name, 'Token do provedor de NF-e');
  update public.company_settings set nf_token_set = true, updated_at = now()
    where user_id = p_user_id;
end; $$;

create or replace function public.get_nf_token(p_user_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets
   where name = 'nf_token_' || p_user_id::text limit 1;
  return v_token;
end; $$;

revoke all on function public.set_nf_token(uuid, text) from public, anon, authenticated;
revoke all on function public.get_nf_token(uuid)       from public, anon, authenticated;
grant execute on function public.set_nf_token(uuid, text) to service_role;
grant execute on function public.get_nf_token(uuid)       to service_role;

-- ── As notas ───────────────────────────────────────────────────────────────

create table if not exists public.notas_fiscais (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  car_id      uuid references public.cars(id) on delete set null,

  -- `ref` e o identificador que mandamos ao provedor. E ele que torna a
  -- emissao IDEMPOTENTE: reenviar a mesma ref nao emite duas notas, e sem isso
  -- um duplo clique viraria duas notas fiscais da mesma venda — que so se
  -- resolve com cancelamento e explicacao ao contador.
  ref         text not null,

  status      text not null default 'processando',  -- processando | autorizada | erro | cancelada
  numero      text,
  serie       integer,
  chave       text,
  valor       numeric(12,2),
  xml_url     text,
  danfe_url   text,
  erro        text,
  ambiente    text not null default 'homologacao',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (user_id, ref)
);

comment on table public.notas_fiscais is
  'Notas emitidas pelo Amply. Uma linha por tentativa de emissao, com a resposta da SEFAZ. `ref` garante idempotencia: duplo clique nao vira duas notas.';

create index if not exists idx_nf_user_car on public.notas_fiscais (user_id, car_id);
create index if not exists idx_nf_status   on public.notas_fiscais (user_id, status)
  where status = 'processando';

alter table public.notas_fiscais enable row level security;

drop policy if exists nf_dono on public.notas_fiscais;
create policy nf_dono on public.notas_fiscais
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
