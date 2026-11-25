-- ============================================================================
-- 124 — Disparo para quem veio de ANÚNCIO, separado por anúncio
-- ============================================================================
--
-- ── O que isto destrava ────────────────────────────────────────────────────
--
-- A origem de anúncio é capturada desde 31/08 em `ad_referrals`, com o
-- `lead_id` preenchido em todas as linhas. O dado estava lá e NADA o usava
-- para montar público: o disparo só sabia falar com "todos", "base importada",
-- status, inativos, lista de espera, agendados do evento e lista colada à mão.
--
-- Medido na DSC em 25/11: **153 leads vieram de anúncio e só 1 recebeu disparo
-- alguma vez**. É o público mais quente da loja, e era o único que ninguém
-- alcançava.
--
-- ── Por que separado POR anúncio, e não um bloco só ───────────────────────
--
-- Os anúncios não pedem a mesma mensagem. Na DSC, no dia desta migration:
--
--     Agende a visita no WhatsApp!          90 leads   21–25/11
--     Quero consignar meu veículo!          22 leads   22–25/11
--     Vectra GT-X | Consulte condições      19 leads   31/08–02/09
--     ONIX 1.4 LTZ | Consulte condições     12 leads   31/08–18/09
--     Preciso de atendimento no Domingo!     9 leads   22–23/11
--
-- Quem clicou em "quero consignar" quer VENDER o carro dele — convite de
-- feirão pra comprar é a mensagem errada. E os 90 de "agende a visita"
-- entraram pelo anúncio do próprio feirão nos últimos dias: já ouviram esse
-- convite. Os 31 do Vectra e do Onix são de agosto, são compradores, e nunca
-- souberam do evento.
--
-- Mandar os 153 de uma vez trataria esses três grupos como o mesmo, e o erro
-- não apareceria em lugar nenhum — só numa taxa de resposta pior e em
-- denúncia, que é o que derruba a qualidade do número.
--
-- O anúncio escolhido viaja em `audience_filter.ad` (o `headline`). Vazio =
-- todos. Não precisa de coluna: o campo já é JSONB.
--
-- ── O que esta migration realmente faz ────────────────────────────────────
--
-- Só abre o CHECK. Sem isto, inserir a campanha com o tipo novo falha com
-- 23514 e a tela não consegue nem criar o rascunho.
--
-- Idempotente: pode ser reexecutada sem erro.
-- ============================================================================

alter table public.campaigns
  drop constraint if exists campaigns_audience_type_check;

alter table public.campaigns
  add constraint campaigns_audience_type_check
  check (audience_type in (
    'all_leads',
    'leads_by_status',
    'leads_inactive',
    'leads_by_interest_vehicle',
    'custom_phones',
    'leads_by_source',
    'evento_agendados',
    'leads_by_ad'
  ));

-- O caminho quente do público novo: achar os leads de um anúncio, ou de todos.
-- Sem isto a consulta varre `ad_referrals` inteira a cada montagem de público
-- e a cada recontagem na tela enquanto o lojista mexe nos filtros.
create index if not exists ad_referrals_user_headline_idx
  on public.ad_referrals (user_id, headline)
  where lead_id is not null;
