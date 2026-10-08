-- 104 — 7 dias de teste
--
-- ── O que quase inviabilizou isto, e o que mudou ───────────────────────────
--
-- A análise de outubro concluiu que teste grátis morre no onboarding: conectar
-- o WhatsApp depende de conta Meta, WABA e verificação, e isso pode consumir o
-- prazo inteiro antes do produto rodar uma vez. A DSC está bloqueada pela Meta
-- há duas semanas — é a prova viva do argumento.
--
-- O que mudou: em 2026-10-05 o Instagram foi aprovado em Advanced Access.
-- Qualquer conta profissional autoriza em dois cliques, sem WABA, sem
-- verificação, sem convite de tester. Conectar o Direct leva menos de um
-- minuto.
--
-- Por isso o teste existe agora, e por isso a tela empurra o Instagram
-- primeiro. Quem começa pelo WhatsApp pode gastar os 7 dias na fila da Meta e
-- sair achando que o produto não funciona.
--
-- ── 7 dias, e não 14 ───────────────────────────────────────────────────────
--
-- Prazo curto é a favor aqui: com o Instagram ligado em um minuto, o que decide
-- não é tempo de setup, é se chega cliente. Uma semana cobre um fim de semana
-- inteiro, que é quando a revenda mais recebe mensagem fora do horário — o
-- argumento mais forte do produto acontece dentro do teste.
--
-- ── Por que uma DATA e não um booleano ─────────────────────────────────────
--
-- `trial_termina_em` responde "quando acaba" sem precisar de outra coluna
-- guardando o início, e torna a expiração uma comparação, não um estado que
-- alguém precisa lembrar de virar.

alter table public.company_settings
  add column if not exists trial_termina_em timestamptz;

comment on column public.company_settings.trial_termina_em is
  'Fim do teste gratis. Nulo = nunca testou ou ja saiu do teste. A expiracao e comparacao de data, nao um estado que alguem precisa lembrar de virar.';

-- Quem está em teste agora. Serve à tela e ao cron de expiração.
create or replace view public.em_teste as
  select user_id, company_name, trial_termina_em,
         greatest(0, ceil(extract(epoch from (trial_termina_em - now())) / 86400))::int as dias_restantes
    from public.company_settings
   where assinatura_status = 'trial'
     and trial_termina_em is not null;

comment on view public.em_teste is
  'Lojas em periodo de teste, com os dias que faltam.';

alter view public.em_teste set (security_invoker = on);

-- ── Começar o teste ────────────────────────────────────────────────────────
--
-- Função, e não um UPDATE da tela, por dois motivos: `assinatura_status` está
-- protegido por trigger (é decisão do dono do sistema, não da loja), e assim o
-- teste não pode ser reiniciado — a condição `trial_termina_em is null` barra
-- quem já testou e quer uma segunda semana.

create or replace function public.comecar_teste(p_user_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_fim timestamptz;
begin
  select trial_termina_em into v_fim
    from public.company_settings where user_id = p_user_id;

  -- Ja testou: devolve a data antiga em vez de dar outra semana.
  if v_fim is not null then return v_fim; end if;

  v_fim := now() + interval '7 days';
  update public.company_settings
     set assinatura_status = 'trial',
         trial_termina_em  = v_fim,
         assinatura_atualizada_em = now()
   where user_id = p_user_id
     and ultimo_pagamento_em is null;   -- quem ja pagou nao volta para teste

  return v_fim;
end; $$;

revoke all on function public.comecar_teste(uuid) from public, anon;
grant execute on function public.comecar_teste(uuid) to authenticated, service_role;
