-- 106 — o teste precisa do bot ligado, e quem paga também
--
-- ── O defeito ──────────────────────────────────────────────────────────────
--
-- `bot_contratado` tem default `false` desde a migration 070, e com razão para
-- a época: o bot era liberado pelo administrador ao fechar a venda, uma loja
-- por vez. Não existia cadastro self-service, nem teste, nem pagamento por
-- cartão.
--
-- Hoje existe, e o default virou uma porta fechada em cima de todo mundo:
--
--   • quem começa o teste recebe 7 dias de um CRM MUDO. `botPodeResponder`
--     checa `bot_contratado` ANTES de olhar a assinatura, então a conta em
--     teste nem chega na trava que foi feita para liberá-la. A tela ainda
--     explicava, com todas as letras, que "o bot não faz parte do seu plano"
--     — para alguém que acabou de pedir justamente o bot.
--
--   • pior: quem PAGA no cartão também. O webhook do Asaas marcava a
--     assinatura como ativa e não encostava em `bot_contratado`. O lojista
--     pagaria a mensalidade e continuaria sem atendimento automático, até
--     alguém reparar no painel. Nunca aconteceu porque todos os clientes de
--     hoje foram ligados à mão, antes da cobrança existir.
--
-- ── O conserto ─────────────────────────────────────────────────────────────
--
-- Duas pontas, porque são dois caminhos de entrada:
--
--   teste    → `comecar_teste()` liga aqui
--   pagamento→ `asaas-webhook` liga ao promover o plano, lendo `inclui_bot`
--
-- O default continua `false`. Conta criada e abandonada no meio do cadastro
-- não deve sair atendendo; o que muda é que agora existe quem ligue.
--
-- ── Por que o teste não é desligado ao expirar ─────────────────────────────
--
-- Quando os 7 dias acabam, `assinaturaEmDia` já cala o bot — `bot_contratado`
-- deixa de importar. Deixá-lo ligado é de propósito: a mensagem que o lojista
-- lê passa a ser "assinatura inativa, o atendimento está pausado", que é
-- verdade e tem saída, em vez de "o bot não faz parte do seu plano", que
-- soaria como se ele nunca tivesse tido direito ao que acabou de usar.

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

  -- O trigger `protege_campos_do_plano` barra mudanca em assinatura_status,
  -- bot_contratado e disparos_contratado quando a claim do JWT diz
  -- 'authenticated' — e barra com razao: sem ela, qualquer usuario logado se
  -- daria assinatura ativa e bot liberado por update direto.
  --
  -- SECURITY DEFINER troca o papel do BANCO, nao a claim, que vem do PostgREST
  -- e continua dizendo 'authenticated'. Por isso a protecao pegava justamente
  -- a funcao que deveria passar por ela. Trocar a claim pelo tempo do update
  -- libera SO por aqui, onde as travas vivem: nao reinicia teste e nao alcanca
  -- quem ja pagou.
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  update public.company_settings
     set assinatura_status = 'trial',
         trial_termina_em  = v_fim,
         -- Sem estas duas linhas o teste e de um CRM mudo. Disparo entra junto
         -- porque todo plano pago visivel inclui disparo: teste que nao tem o
         -- que o plano tem nao mede o que o lojista vai comprar.
         bot_contratado      = true,
         disparos_contratado = true,
         assinatura_atualizada_em = now()
   where user_id = p_user_id
     and ultimo_pagamento_em is null;   -- quem ja pagou nao volta para teste

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  return v_fim;
end;
$fn$;

revoke all on function public.comecar_teste(uuid) from public, anon;
grant execute on function public.comecar_teste(uuid) to authenticated, service_role;

-- Quem ja esta em teste agora, antes deste conserto existir.
update public.company_settings
   set bot_contratado = true, disparos_contratado = true
 where assinatura_status = 'trial'
   and trial_termina_em > now()
   and bot_contratado = false;
