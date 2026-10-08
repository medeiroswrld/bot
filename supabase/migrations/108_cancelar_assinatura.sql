-- 108 — cancelar a assinatura pela tela, sem perder o que já foi pago
--
-- ── Por que o botão precisa existir ────────────────────────────────────────
--
-- Cobrança recorrente no cartão sem cancelamento pelo mesmo canal onde se
-- assinou não se sustenta. Hoje o lojista teria de pedir por WhatsApp e
-- esperar alguém mexer no painel do Asaas — e enquanto espera, é cobrado.
--
-- ── O problema que o botão criaria sem esta coluna ─────────────────────────
--
-- `assinaturaEmDia` recusa `cancelada`, então cancelar cortava o bot NO
-- INSTANTE. Quem pagasse dia 8 e cancelasse dia 10 perderia 28 dias que já
-- pagou. Isso não é rigor, é cobrar por um mês e entregar dois dias — e volta
-- como reclamação ou chargeback, que custa mais que o mês.
--
-- A correção é dar o período já pago. Mas `cancelada` não quer dizer uma coisa
-- só: o webhook chega nesse estado por cinco caminhos diferentes, e três deles
-- NÃO merecem cortesia nenhuma.
--
--   SUBSCRIPTION_DELETED          o lojista cancelou   → fica até o fim do mês pago
--   SUBSCRIPTION_INACTIVATED      o Asaas inativou     → sem cortesia
--   PAYMENT_REFUNDED              dinheiro devolvido   → sem cortesia
--   PAYMENT_CHARGEBACK_REQUESTED  contestou no cartão  → sem cortesia
--   PAYMENT_DELETED               cobrança removida    → sem cortesia
--
-- Sem guardar QUAL deles aconteceu, dar o mês de cortesia a `cancelada`
-- entregaria um mês de bot de graça a quem acabou de pedir o dinheiro de
-- volta. Por isso a coluna: o estado diz que parou, o motivo diz se foi o
-- cliente saindo pela porta ou o dinheiro voltando.

alter table public.company_settings
  add column if not exists assinatura_motivo text;

comment on column public.company_settings.assinatura_motivo is
  'Por que a assinatura chegou ao estado atual. So o motivo `cancelamento` (o lojista cancelou) mantem o acesso ate o fim do periodo ja pago; estorno e chargeback cortam na hora.';

-- Protegida como o resto da assinatura: quem escreve e o webhook, nao a tela.
-- Sem isto o lojista se daria o mes de cortesia por update direto, ja que a
-- RLS de company_settings e por LINHA e nao por coluna.
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

  if new.plano is distinct from old.plano then
    raise exception 'O plano é definido pelo administrador do sistema.';
  end if;

  if new.plano_pretendido is distinct from old.plano_pretendido then
    raise exception 'O plano escolhido é gravado pelo checkout, não pelo aplicativo.';
  end if;

  if new.suspenso is distinct from old.suspenso then
    raise exception 'A suspensão é definida pelo administrador do sistema.';
  end if;

  if new.capi_dataset_id is distinct from old.capi_dataset_id
     or new.capi_enabled is distinct from old.capi_enabled then
    raise exception 'A integração de anúncios é definida pelo administrador do sistema.';
  end if;

  if new.assinatura_status      is distinct from old.assinatura_status
     or new.assinatura_motivo     is distinct from old.assinatura_motivo
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
