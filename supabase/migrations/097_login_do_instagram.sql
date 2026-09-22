-- 097 — login do Instagram, no lugar do ID e do token colados à mão
--
-- Até aqui, conectar o Direct era: o lojista abre o painel da Meta, acha o ID da
-- conta, gera um token e cola os dois em dois campos de texto. Funciona, e tem
-- três defeitos que só aparecem com o tempo:
--
--   1. Ninguém, fora nós, consegue fazer. Não é configuração de lojista.
--   2. Não existe consentimento visível — foi por isso que a Meta reprovou o
--      screencast do App Review: ela quer ver o usuário AUTORIZANDO.
--   3. O token colado à mão MORRE EM 60 DIAS, em silêncio. O sintoma é "o bot
--      parou de responder no Direct", sem erro em lugar nenhum.
--
-- O terceiro é o que esta migration resolve do lado do banco.
--
-- ── Por que uma coluna de validade, e não um "conectado sim/não" ───────────
--
-- Token do WhatsApp, vindo do Embedded Signup, não expira. O do Instagram
-- expira, e pode ser RENOVADO antes de morrer (`ig_refresh_token`), desde que
-- tenha pelo menos 24 horas de vida. Ou seja: não basta saber que existe, é
-- preciso saber QUANDO vence, senão não há como renovar a tempo.
--
-- Guardar a validade aqui, e não junto do token no Vault, é de propósito: é
-- dado operacional, consultado por cron e mostrado na tela, e nada disso
-- justifica descriptografar um segredo.
--
-- ── ig_username ───────────────────────────────────────────────────────────
--
-- O @ do perfil, só para a tela poder dizer "conectado como @dscseminovos" em
-- vez de mostrar dezessete dígitos. Loja com mais de uma conta não tem como
-- conferir se conectou a certa olhando para um número.

alter table public.company_settings
  add column if not exists ig_token_expira_em timestamptz,
  add column if not exists ig_username        text;

comment on column public.company_settings.ig_token_expira_em is
  'Quando o token longo do Instagram vence (60 dias a partir da conexao). Usado para renovar ANTES de morrer: token vencido nao avisa, so para de responder.';

comment on column public.company_settings.ig_username is
  'O @ do perfil conectado. So para a tela — a identificacao de verdade e o ig_user_id.';

-- Quem está perto de vencer. O cron de renovação lê daqui.
--
-- Dez dias de folga porque a renovação pode falhar e precisar de outra tentativa
-- no dia seguinte — e porque uma loja que fica sem Direct numa sexta-feira só
-- descobre na segunda.
create or replace view public.instagram_a_renovar as
  select user_id,
         ig_user_id,
         ig_username,
         ig_token_expira_em
    from public.company_settings
   where ig_user_id is not null
     and ig_token_expira_em is not null
     and ig_token_expira_em < now() + interval '10 days';

comment on view public.instagram_a_renovar is
  'Contas cujo token do Instagram vence em menos de 10 dias. Nao expoe token nenhum: so quem precisa ser renovado.';

-- A view herda o RLS de company_settings (security_invoker), então um lojista
-- que a consultasse veria apenas a própria linha. Ainda assim ela existe para o
-- cron, que roda como service_role.
alter view public.instagram_a_renovar set (security_invoker = on);
