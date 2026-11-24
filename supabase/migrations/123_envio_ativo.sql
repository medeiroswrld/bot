-- ============================================================================
-- 123 — Marca de "envio ativo da loja" nas mensagens
-- ============================================================================
--
-- A aba Disparos das Conversas filtra por `campaign_id is not null`. Isso
-- deixa de fora todo envio ativo que NÃO nasce de uma campanha — hoje, o aviso
-- da lista de espera, que sai por outra function e não cria campanha nenhuma.
--
-- O lojista não enxerga essa diferença, e nem deveria: pra ele é tudo "a loja
-- falou primeiro". Em 24/11 ele avisou 5 pessoas e procurou as três na aba, que
-- continuou mostrando só a campanha do dia anterior.
--
-- POR QUE UMA COLUNA E NÃO UMA CAMPANHA SINTÉTICA:
-- criar uma linha em `campaigns` só pra o aviso aparecer encheria a tela de
-- campanhas de registros que ninguém disparou, e bagunçaria os contadores de
-- enviados/falhas que a tela de Marketing mostra.
--
-- `campaign_id` continua existindo e mandando no que é campanha — esta coluna
-- cobre o resto. A aba passa a perguntar "tem um OU outro".
--
-- Idempotente: pode ser reexecutada sem erro.
-- ============================================================================

alter table public.messages
  add column if not exists envio_ativo text;

comment on column public.messages.envio_ativo is
  'Envio ATIVO da loja que não veio de campanha: ''lista_espera'', ''lembrete''. NULL = conversa normal (resposta do bot ou do atendente). Campanha continua marcada por campaign_id.';

-- Índice parcial: a aba Disparos busca justamente as poucas linhas marcadas,
-- não quer varrer a tabela inteira de mensagens.
create index if not exists messages_envio_ativo_idx
  on public.messages (envio_ativo)
  where envio_ativo is not null;
