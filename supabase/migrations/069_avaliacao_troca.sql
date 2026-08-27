-- 069 — avaliação estimada do carro da troca, a partir da FIPE e da nota
--
-- Hoje o bot coleta os dados do carro que o cliente quer dar na troca e a
-- conversa morre ali: o valor só sai quando alguém da loja avalia. O cliente
-- fica sem âncora nenhuma e some para pedir avaliação em outro lugar.
--
-- A conta é a que o lojista já faz de cabeça: pega a FIPE, aplica a nota que o
-- próprio dono deu para o carro. Nota 7 num carro de 50 mil = 70% = R$ 35.000.
--
-- LIGADA/DESLIGADA por loja, e desligada por padrão. Loja que trabalha com
-- outra base de cálculo — ou que não quer o bot dando número nenhum antes de
-- ver o carro — não pode ter isso ativado sem pedir.

alter table public.company_settings
  add column if not exists trade_in_valuation_enabled boolean not null default false,
  -- Teto de segurança. Nota 10 pela regra pura significaria pagar 100% da FIPE,
  -- que nenhuma loja faz — e o bot prometendo isso vira discussão no balcão.
  add column if not exists trade_in_valuation_max_percent numeric not null default 90;

comment on column public.company_settings.trade_in_valuation_enabled is
  'Se o bot pode estimar o valor do carro da troca a partir da FIPE e da nota do dono.';

comment on column public.company_settings.trade_in_valuation_max_percent is
  'Percentual máximo da FIPE que a estimativa pode alcançar, mesmo com nota 10.';
