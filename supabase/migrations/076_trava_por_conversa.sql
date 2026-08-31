-- 076 — uma resposta por vez, por conversa
--
-- A trava que existia (`last_handled_msg_id`) é DEDUPE, não exclusão mútua:
-- ela impede duas execuções com a MESMA mensagem, e não duas execuções ao
-- mesmo tempo com mensagens diferentes.
--
-- O caso real (DSC, 31/08): o cliente escolheu "Celta 2012", o bot começou a
-- gerar, e um minuto depois ele mandou "O de 24.900". A segunda execução gravou
-- uma chave diferente, passou pela trava, e as duas responderam — o cliente
-- recebeu a mesma simulação de financiamento duas vezes, com palavras
-- diferentes. Aconteceu de novo em outra conversa com "Vc tem mais foto" e
-- "Qual o valor".
--
-- O debounce de 2s no webhook não alcança isso: ele junta mensagens quase
-- simultâneas, mas não segura uma que chega no meio da geração — que leva
-- dezenas de segundos quando tem chamada de ferramenta.
--
-- Aqui a trava passa a ser POR CONVERSA. Quem não consegue entrar não é
-- descartado: marca que sobrou mensagem pra responder, e quem está lá dentro
-- dispara uma nova rodada ao terminar. Sem isso, a última mensagem do cliente
-- ficaria sem resposta — que é pior do que responder duas vezes.

alter table public.conversations
  add column if not exists processing_since    timestamptz,
  add column if not exists reprocess_pending   boolean not null default false;

comment on column public.conversations.processing_since is
  'Quando a geração em curso começou. NULL = livre. Expira sozinho para não travar a conversa se a execução morrer no meio.';
comment on column public.conversations.reprocess_pending is
  'Chegou mensagem do cliente enquanto o bot gerava. Quem está processando dispara outra rodada ao sair.';

-- Índice parcial: a varredura de travas vencidas só olha o que está ocupado.
create index if not exists conversations_processing_idx
  on public.conversations (processing_since)
  where processing_since is not null;

-- Rede de segurança: execução que morreu (timeout, deploy no meio, erro não
-- tratado) deixaria a conversa travada para sempre. A trava vence em 3 minutos
-- — bem acima da geração mais lenta, bem abaixo da paciência de um cliente.
--
-- NÃO precisa de cron: a expiração é avaliada na hora de pegar a trava
-- (`processing_since < agora - 3min`), então uma trava órfã se resolve sozinha
-- na próxima mensagem. O update abaixo é só uma limpeza única, para o caso de
-- a coluna nascer com lixo de um deploy anterior.
update public.conversations
   set processing_since = null
 where processing_since is not null
   and processing_since < now() - interval '3 minutes';
