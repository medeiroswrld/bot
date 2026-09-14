-- 090 — guardar o id do checkout, que é o que amarra o pagamento à loja
--
-- O primeiro teste de ponta a ponta no sandbox funcionou até o último passo: o
-- webhook recebeu PAYMENT_CREATED e PAYMENT_CONFIRMED, gravou os dois, e não
-- conseguiu dizer de QUEM era o pagamento. A conta continuou 'sem_assinatura'
-- com o dinheiro pago.
--
-- ── Por que os dois caminhos falharam ───────────────────────────────────────
--
-- 1. `externalReference` — nós mandamos o user_id na criação do checkout, e o
--    Asaas NÃO propaga esse campo para o pagamento gerado. Chega null. Isso não
--    está escrito em lugar nenhum da documentação; só aparece olhando o payload
--    de verdade.
--
-- 2. `customer` — o cliente do pagamento é criado pelo próprio checkout, no
--    momento em que o pagador preenche os dados. Ou seja, o id só existe DEPOIS
--    do pagamento, e não há como tê-lo guardado antes.
--
-- ── O que funciona ──────────────────────────────────────────────────────────
--
-- O pagamento traz `checkoutSession`, apontando de volta para a sessão que nós
-- criamos. Guardando esse id no momento da criação, o vínculo fica fechado dos
-- dois lados e não depende de nada que o Asaas decida propagar ou não.
--
-- Da segunda cobrança em diante o `customer` já serve, porque o webhook grava o
-- id quando o primeiro pagamento é identificado. O checkout resolve justamente
-- o caso mais difícil: o primeiro.

alter table public.company_settings
  add column if not exists asaas_checkout_id text;

comment on column public.company_settings.asaas_checkout_id is
  'Sessão de checkout aberta para esta loja. É por ela que o PRIMEIRO pagamento é identificado — o externalReference não desce do checkout para o pagamento, e o id do cliente só nasce depois que o pagador preenche os dados.';

create index if not exists company_settings_asaas_checkout_idx
  on public.company_settings (asaas_checkout_id)
  where asaas_checkout_id is not null;

-- Mesma proteção das outras colunas de cobrança: a RLS abre a linha para o
-- dono, e sem o trigger o lojista poderia apontar o próprio registro para um
-- checkout pago por outra pessoa.
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

  if new.assinatura_status    is distinct from old.assinatura_status
     or new.asaas_customer_id     is distinct from old.asaas_customer_id
     or new.asaas_subscription_id is distinct from old.asaas_subscription_id
     or new.asaas_checkout_id     is distinct from old.asaas_checkout_id
     or new.proximo_vencimento    is distinct from old.proximo_vencimento
     or new.ultimo_pagamento_em   is distinct from old.ultimo_pagamento_em then
    raise exception 'A assinatura é definida pelo pagamento, não pelo aplicativo.';
  end if;

  return new;
end;
$$;

-- Limpeza: a conta de teste guardou um cliente da conta de PRODUÇÃO, criado
-- numa tentativa anterior. Apontar para o ambiente errado é pior que não ter
-- nada — o webhook do sandbox nunca casaria com ele.
update public.company_settings
   set asaas_customer_id = null
 where asaas_customer_id = 'cus_000200421913';
