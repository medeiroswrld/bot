-- 105 — a expiração do teste, e o plano que só vale depois de pagar
--
-- ── Por que esta migration existe ──────────────────────────────────────────
--
-- Duas coisas estavam fora do repositório:
--
--   1. O cron que expira o teste. Ele existe no banco desde o dia 104, mas
--      nunca foi escrito aqui. Banco reconstruído sem ele = teste que nunca
--      acaba, e todo mundo de graça para sempre. Este projeto já perdeu três
--      features para drift de migration; esta seria a quarta, e a mais cara.
--
--   2. A diferença entre o plano que o lojista QUER e o plano que ele TEM.
--      Sem ela, clicar num cartão de preço e desistir do checkout deixava o
--      registro dizendo que a loja era Crescimento de R$1.497 — e a tela de
--      assinatura passava a oferecer aquele valor como se fosse combinado.

-- ── 1. O cron ──────────────────────────────────────────────────────────────
--
-- `create` com unschedule antes, e não `if not exists`: pg_cron não tem isso, e
-- rodar duas vezes criaria dois jobs fazendo o mesmo update.
--
-- Roda como postgres, sem `request.jwt.claims` — por isso passa pelo
-- `protege_campos_do_plano`, que só barra quem vem como 'authenticated'.

select cron.unschedule('expirar-testes-diario')
 where exists (select 1 from cron.job where jobname = 'expirar-testes-diario');

select cron.schedule('expirar-testes-diario', '0 6 * * *', $cron$
  update public.company_settings
     set assinatura_status = 'sem_assinatura',
         assinatura_atualizada_em = now()
   where assinatura_status = 'trial'
     and trial_termina_em < now();
$cron$);

-- ── 2. O plano pretendido ──────────────────────────────────────────────────
--
-- `plano` passa a significar "plano confirmado por pagamento". A escolha antes
-- de pagar mora aqui, e o webhook do Asaas promove uma na outra.
--
-- Isso conserta um efeito colateral que ninguém tinha visto: `billing_amount` é
-- o preço NEGOCIADO, escrito pelo administrador ao fechar a venda. O checkout
-- sobrescrevia aquilo no clique — um lojista curioso apagava o desconto que
-- alguém combinou com ele por telefone.

alter table public.company_settings
  add column if not exists plano_pretendido text references public.planos(slug);

comment on column public.company_settings.plano_pretendido is
  'Plano que o lojista escolheu no checkout e ainda nao pagou. O webhook do Asaas promove para `plano` quando o pagamento confirma. Nulo = nada pendente.';

-- ── 3. A intenção também é protegida ───────────────────────────────────────
--
-- Sem isto, o lojista abriria o checkout do Essencial, trocaria o
-- `plano_pretendido` por Performance pela API e pagaria o preço do barato
-- levando o limite do caro. O valor do checkout vem da tabela `planos` no
-- servidor; é a promoção, e não o preço, que precisava desta trava.

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

-- ── 4. Uso do mês durante o teste ──────────────────────────────────────────
--
-- `meu_uso_do_mes` caía em 'personalizado' quando `plano` era nulo, e
-- 'personalizado' quer dizer "sem limite". Quem está em TESTE passaria a ver
-- "sem limite de conversas" — exatamente a informação errada para quem precisa
-- decidir qual plano assinar em sete dias.
--
-- No teste o limite mostrado é o do plano de entrada visível. Não é cobrança:
-- o teste não corta ninguém. É régua, para a conversa de plano acontecer com
-- um número na frente dos dois.

create or replace function public.meu_uso_do_mes()
returns table (usadas int, limite int, plano_nome text, plano_slug text)
language sql
stable
security definer
set search_path = ''
as $$
  -- O plano de entrada VISIVEL, lido da tabela. Escrever 'essencial' aqui
  -- desencontraria da escada no dia em que ela mudar de nome ou de ordem.
  with entrada as (
    select slug, nome, limite_conversas
      from public.planos
     where visivel = true and inclui_bot = true and preco is not null
     order by ordem
     limit 1
  )
  select
    public.conversas_do_mes(cs.user_id),
    coalesce(p.limite_conversas, e.limite_conversas),
    coalesce(p.nome, e.nome, 'Personalizado'),
    coalesce(cs.plano, e.slug, 'personalizado')
  from public.company_settings cs
  left join public.planos p on p.slug = cs.plano
  -- A condicao esta no JOIN, nao no WHERE: quem nao esta em teste simplesmente
  -- nao casa, e `e.*` vem nulo, caindo no comportamento antigo.
  left join entrada e on cs.assinatura_status = 'trial' and cs.plano is null
  where cs.user_id = auth.uid();
$$;

revoke all on function public.meu_uso_do_mes() from public, anon;
grant execute on function public.meu_uso_do_mes() to authenticated;
