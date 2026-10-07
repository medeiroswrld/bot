-- 099 — marca quem já viu o tour de boas-vindas
--
-- No banco e não no localStorage de propósito: lojista que entra pelo celular
-- e depois pelo computador veria o tour duas vezes, e tour repetido é a forma
-- mais rápida de ensinar alguém a clicar em "pular" sem ler.
--
-- Guarda QUANDO, não um booleano. Se um dia o produto mudar o suficiente para
-- justificar reapresentar, dá para decidir por data em vez de precisar de
-- outra coluna.

alter table public.company_settings
  add column if not exists tour_visto_em timestamptz;

comment on column public.company_settings.tour_visto_em is
  'Quando o lojista viu o tour de boas-vindas. Nulo = ainda nao viu, e o tour abre sozinho no proximo login.';
