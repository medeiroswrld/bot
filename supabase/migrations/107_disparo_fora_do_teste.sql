-- 107 — disparo fica fora do teste
--
-- ── A decisão ──────────────────────────────────────────────────────────────
--
-- O teste de 7 dias libera o bot, não o envio em massa.
--
-- O motivo é custo de terceiro, e é diferente do custo do bot. Conversa de bot
-- custa modelo, centavos, e só acontece se um cliente real escrever primeiro.
-- Disparo custa TEMPLATE à Meta, é iniciado pelo lojista e escala com um
-- clique — é o único pedaço do produto onde um cadastro grátis gasta dinheiro
-- nosso sem ninguém do outro lado ter pedido nada.
--
-- E não custa quase nada ao teste: o que o lojista precisa descobrir em sete
-- dias é se o assistente atende bem o cliente que chega. Disparo é o que ele
-- faz depois de decidir ficar.
--
-- ── Por que uma coluna em `planos`, e não `disparos = bot` no código ───────
--
-- A migration 071 escolheu dois booleanos independentes de propósito: a venda
-- pedia CRM sozinho, CRM + disparo, e CRM + disparo + bot. Amarrar disparo a
-- `inclui_bot` no webhook funcionaria hoje, porque a tabela de hoje não tem
-- plano de disparo sem bot — e quebraria calado no dia em que tiver.
--
-- Com a coluna aqui, esse dia é uma edição de linha, não um deploy.

alter table public.planos
  add column if not exists inclui_disparos boolean not null default true;

comment on column public.planos.inclui_disparos is
  'Se o plano inclui envio em massa (campanha, aniversario, template). Separado de inclui_bot porque a venda pede as duas combinacoes.';

-- Hoje nenhum plano separa os dois: quem tem bot tem disparo, e o plano CRM
-- não tem nenhum dos dois. A semente registra isso em vez de assumir.
update public.planos set inclui_disparos = inclui_bot;

-- ── O teste não liga mais o disparo ────────────────────────────────────────

create or replace function public.comecar_teste(p_user_id uuid)
returns timestamptz language plpgsql security definer set search_path = ''
as $fn$
declare
  v_fim    timestamptz;
  v_claims text;
begin
  select trial_termina_em into v_fim
    from public.company_settings where user_id = p_user_id;

  -- Ja testou: devolve a data antiga em vez de dar outra semana.
  if v_fim is not null then return v_fim; end if;

  v_fim := now() + interval '7 days';

  -- SECURITY DEFINER troca o papel do BANCO, nao a claim do JWT, que vem do
  -- PostgREST dizendo 'authenticated' — e era por isso que o
  -- `protege_campos_do_plano` pegava justamente a funcao que deveria passar
  -- por ele. Trocar a claim pelo tempo do update libera SO por aqui.
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  update public.company_settings
     set assinatura_status = 'trial',
         trial_termina_em  = v_fim,
         -- Sem esta linha o teste e de um CRM mudo: `botPodeResponder` checa
         -- `bot_contratado` ANTES da assinatura, e a conta em teste nem
         -- chegava na trava escrita para libera-la.
         bot_contratado    = true,
         assinatura_atualizada_em = now()
   where user_id = p_user_id
     and ultimo_pagamento_em is null;   -- quem ja pagou nao volta para teste

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  return v_fim;
end;
$fn$;

revoke all on function public.comecar_teste(uuid) from public, anon;
grant execute on function public.comecar_teste(uuid) to authenticated, service_role;

-- Quem entrou em teste nas horas em que o disparo estava ligado.
update public.company_settings
   set disparos_contratado = false
 where assinatura_status = 'trial'
   and ultimo_pagamento_em is null
   and disparos_contratado = true;
