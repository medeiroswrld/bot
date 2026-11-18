-- ============================================================================
-- 118 — Disparo para quem agendou no evento (feirão)
-- ============================================================================
--
-- Libera o público `evento_agendados` no CHECK de campaigns.
--
-- Por que é um público próprio, e não um filtro de leads: quem tem visita
-- MARCADA num feirão já se comprometeu a aparecer. É um grupo pequeno, quente,
-- e a mensagem para ele é um LEMBRETE (UTILITY na Meta) — não a mesma peça
-- promocional que vai para a base fria. Misturar os dois na mesma campanha
-- obrigaria a usar a categoria de marketing para todo mundo, que é mais caro e
-- fica bloqueado para quem optou por não receber oferta: justamente as pessoas
-- que já agendaram.
--
-- A origem do dado é `appointments.evento_id` (migration 117), gravado pelo
-- servidor quando a data da visita cai dentro do evento.
--
-- NÃO precisa de coluna nova para o teto por disparo: `audience_filter` já é
-- JSONB, então `{"limite": 100}` entra sem mexer no schema.
-- ============================================================================

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_audience_type_check;

ALTER TABLE campaigns ADD CONSTRAINT campaigns_audience_type_check
  CHECK (audience_type IN (
    'all_leads',
    'leads_by_status',
    'leads_inactive',
    'leads_by_interest_vehicle',
    'custom_phones',
    'leads_by_source',
    'evento_agendados'
  ));

COMMENT ON COLUMN campaigns.audience_filter IS
  'Filtros do público, em JSONB. Chaves usadas: statuses, days_inactive, model, '
  'phones, sources, idade, excluir_ja_recebeu, excluir_dias, '
  'evento_id e so_futuras (público evento_agendados), '
  'e limite — teto de destinatários por disparo, que existe para aquecer número '
  'novo: número recém-conectado começa em 250 conversas iniciadas pela empresa '
  'por 24h, e mandar uma base inteira de uma vez é padrão de banimento.';
