-- 073 — devolver conversão pra Meta (Conversions API para Business Messaging)
--
-- A 072 capturou o clique. Esta fecha o ciclo: avisa a Meta quais desses
-- cliques viraram lead qualificado, visita e venda, pra o algoritmo otimizar
-- por COMPRADOR em vez de por conversa iniciada.
--
-- Sem isto a Meta só sabe que a conversa começou. Ela otimiza pelo que
-- consegue medir, então entrega o anúncio pra quem costuma abrir conversa —
-- não pra quem costuma comprar. É exatamente o que a loja sente como "chega
-- muito lead ruim".
--
-- ── O QUE A META ACEITA (docs oficiais, conferido 2026-08-30) ───────────────
-- Endpoint: POST graph.facebook.com/v20.0/{DATASET_ID}/events
-- Obrigatórios: action_source='business_messaging', messaging_channel='whatsapp'
-- user_data no canal WhatsApp: whatsapp_business_account_id + ctwa_clid
--   NÃO é page_id — page_id é o do Messenger. Errar aqui falha em silêncio.
-- event_name válidos incluem QualifiedLead, InitiateCheckout e Purchase.
--   Não existe "Schedule" na lista. Visita agendada vira InitiateCheckout, que
--   é o mais próximo: a pessoa entrou no processo de compra.

-- ── 1. Configuração por loja ────────────────────────────────────────────────
alter table public.company_settings
  add column if not exists capi_dataset_id text,
  add column if not exists capi_enabled    boolean not null default false;

comment on column public.company_settings.capi_dataset_id is
  'Dataset da Meta que recebe as conversões. Definido pelo administrador — quem gerencia o anúncio é quem tem o dataset.';

-- Admin-only, junto com o plano. Se a loja escolhesse o dataset, poderia
-- apontar conversões pro dataset de terceiro — e a RLS de company_settings é
-- por linha, não por coluna (a mesma brecha que a 070 fechou).
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

  if new.capi_dataset_id is distinct from old.capi_dataset_id
     or new.capi_enabled is distinct from old.capi_enabled then
    raise exception 'A integração de anúncios é definida pelo administrador do sistema.';
  end if;

  return new;
end;
$$;

-- ── 2. Token do CAPI no Vault ───────────────────────────────────────────────
-- Mesmo padrão do token do WhatsApp (015): nunca em coluna, nunca no front.
-- Opcional por loja — ausente, a function cai no token global da Amply
-- (env META_CAPI_TOKEN), que é o caso normal enquanto o dataset é dela.
create or replace function public.set_capi_token(p_user_id uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := 'capi_token_' || p_user_id::text;
  v_id   uuid;
begin
  select id into v_id from vault.secrets where name = v_nome;
  if v_id is null then
    perform vault.create_secret(p_token, v_nome, 'Token CAPI da loja ' || p_user_id::text);
  else
    perform vault.update_secret(v_id, p_token);
  end if;
end;
$$;

create or replace function public.get_capi_token(p_user_id uuid)
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
  where ds.name = 'capi_token_' || p_user_id::text;
  return v_token;
end;
$$;

revoke all on function public.set_capi_token(uuid, text) from public, anon, authenticated;
revoke all on function public.get_capi_token(uuid)       from public, anon, authenticated;
grant  execute on function public.set_capi_token(uuid, text) to service_role;
grant  execute on function public.get_capi_token(uuid)       to service_role;

-- ── 3. Fila de eventos ──────────────────────────────────────────────────────
-- Fila, e não envio direto no trigger: chamada HTTP dentro de transação trava a
-- escrita do CRM se a Meta demorar, e uma falha da Meta faria rollback de uma
-- mudança de status que o vendedor acabou de fazer. O CRM não pode depender da
-- Meta estar de pé.
create table if not exists public.capi_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  lead_id        uuid references public.leads(id) on delete cascade,
  ad_referral_id uuid references public.ad_referrals(id) on delete set null,

  event_name     text not null,          -- QualifiedLead | InitiateCheckout | Purchase
  event_time     timestamptz not null default now(),
  valor          numeric,                -- só em Purchase
  moeda          text not null default 'BRL',

  status         text not null default 'pendente',  -- pendente | enviado | expirado | erro
  tentativas     integer not null default 0,
  ultimo_erro    text,
  enviado_em     timestamptz,
  created_at     timestamptz not null default now()
);

-- Um evento de cada tipo por lead. Sem isto, o vendedor que arrasta o card de
-- "proposta" pra "novo" e de volta geraria dois QualifiedLead pra mesma pessoa
-- — e evento duplicado ensina a Meta que aquele clique vale o dobro.
create unique index if not exists capi_events_uniq
  on public.capi_events (lead_id, event_name);

create index if not exists capi_events_pendentes_idx
  on public.capi_events (status, created_at)
  where status = 'pendente';

alter table public.capi_events enable row level security;

drop policy if exists capi_events_select_own on public.capi_events;
create policy capi_events_select_own on public.capi_events
  for select using (auth.uid() = user_id);

-- ── 4. Telefone normalizado ─────────────────────────────────────────────────
-- `appointments` não tem lead_id: a ligação é por telefone. E o mesmo celular
-- aparece como 5515988372081 e 551598372081 conforme quem gravou (o nono
-- dígito entrou em épocas diferentes por região). Comparar texto cru faria a
-- visita não achar o lead justamente nos cadastros mais antigos.
create or replace function public.chave_telefone(p_fone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when length(t.d) >= 10 then right(t.d, 8) else null end
  from (select regexp_replace(coalesce(p_fone, ''), '\D', '', 'g') as d) t;
$$;

-- ── 5. Enfileira a partir do funil ──────────────────────────────────────────
create or replace function public.enfileira_capi_do_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref_id uuid;
  v_valor  numeric;
begin
  -- Só lead que veio de anúncio gera evento. Lead orgânico não tem clique pra
  -- atribuir, e mandar mesmo assim seria ruído puro pro algoritmo.
  select r.id into v_ref_id
    from public.ad_referrals r
   where r.lead_id = new.id
     and r.ctwa_clid is not null
   order by r.created_at desc
   limit 1;

  if v_ref_id is null then
    return new;
  end if;

  -- Qualificado: entrou de verdade no funil. "atendimento" fica de fora de
  -- propósito — todo mundo que responde uma mensagem passa por lá, e evento
  -- que todo lead dispara não ensina nada à Meta.
  if new.status in ('proposta', 'negociacao', 'vendido') then
    insert into public.capi_events (user_id, lead_id, ad_referral_id, event_name, event_time)
    values (new.user_id, new.id, v_ref_id, 'QualifiedLead', now())
    on conflict (lead_id, event_name) do nothing;
  end if;

  if new.status = 'vendido' then
    select c.sold_price into v_valor
      from public.cars c
     where c.id = new.sold_car_id;

    insert into public.capi_events
      (user_id, lead_id, ad_referral_id, event_name, event_time, valor)
    values
      (new.user_id, new.id, v_ref_id, 'Purchase',
       coalesce(new.sold_at, now()), v_valor)
    on conflict (lead_id, event_name) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_capi_do_lead on public.leads;
create trigger trg_capi_do_lead
  after insert or update of status, sold_car_id, sold_at on public.leads
  for each row
  execute function public.enfileira_capi_do_lead();

-- ── 6. Enfileira a partir da visita agendada ────────────────────────────────
create or replace function public.enfileira_capi_da_visita()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_id uuid;
  v_ref_id  uuid;
begin
  select l.id into v_lead_id
    from public.leads l
   where l.user_id = new.user_id
     and public.chave_telefone(l.phone) = public.chave_telefone(new.customer_phone)
   order by l.created_at desc
   limit 1;

  if v_lead_id is null then
    return new;
  end if;

  select r.id into v_ref_id
    from public.ad_referrals r
   where r.lead_id = v_lead_id
     and r.ctwa_clid is not null
   order by r.created_at desc
   limit 1;

  if v_ref_id is null then
    return new;
  end if;

  insert into public.capi_events (user_id, lead_id, ad_referral_id, event_name, event_time)
  values (new.user_id, v_lead_id, v_ref_id, 'InitiateCheckout', now())
  on conflict (lead_id, event_name) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_capi_da_visita on public.appointments;
create trigger trg_capi_da_visita
  after insert on public.appointments
  for each row
  execute function public.enfileira_capi_da_visita();

-- ── 7. Relatório por anúncio ────────────────────────────────────────────────
-- View e não query solta na tela: a mesma pergunta ("qual anúncio traz venda?")
-- vai ser feita na tela do lojista e no painel do administrador.
create or replace view public.anuncio_desempenho
with (security_invoker = true)
as
select
  r.user_id,
  r.source_id,
  min(r.headline)                                           as headline,
  count(distinct r.lead_id)                                 as leads,
  count(distinct l.id) filter (
    where l.status in ('proposta', 'negociacao', 'vendido')
  )                                                         as qualificados,
  count(distinct l.id) filter (where l.status = 'vendido')   as vendas,
  coalesce(sum(c.sold_price) filter (where l.status = 'vendido'), 0) as faturamento,
  min(r.created_at)                                         as primeiro_clique,
  max(r.created_at)                                         as ultimo_clique
from public.ad_referrals r
left join public.leads l on l.id = r.lead_id
left join public.cars  c on c.id = l.sold_car_id
where r.source_id is not null
group by r.user_id, r.source_id;

comment on view public.anuncio_desempenho is
  'Leads, qualificados, vendas e faturamento por anúncio. security_invoker: cada loja vê só o que a RLS de ad_referrals permite.';
