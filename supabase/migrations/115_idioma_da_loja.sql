-- 115 — o idioma em que a loja atende
--
-- ── Por que isto existe ───────────────────────────────────────────────────
--
-- O prompt é todo em português do Brasil e nunca disse nada sobre idioma. O
-- modelo responde em português porque é nele que foi instruído, não porque
-- alguém decidiu.
--
-- Com a prospecção indo para Portugal e Espanha, isso passa a ser decisão de
-- produto: um stand em Lisboa precisa falar português de Portugal, e um
-- cliente que escreve em espanhol precisa ser respondido em espanhol.
--
-- ── Por que NÃO é só "responder no idioma do cliente" ─────────────────────
--
-- Vocabulário local não é tradução. Num stand português:
--
--     placa         → matrícula
--     celular       → telemóvel
--     loja          → stand
--     IPVA          → IUC
--     licenciamento → ISV
--
-- Um stand português que receba "vou ver a placa do carro" sabe na hora que o
-- sistema é brasileiro — e é o tipo de detalhe que derruba a confiança antes
-- de qualquer demonstração.
--
-- Daí DUAS coisas separadas:
--
--   `locale` da loja   define o vocabulário e os termos legais do país
--   idioma do cliente  o bot espelha quem escreveu
--
-- Um brasileiro escrevendo para um stand em Lisboa é respondido no português
-- dele, mas o documento do carro continua sendo "matrícula" — porque é esse o
-- nome da coisa naquele país.

alter table public.company_settings
  add column if not exists locale text not null default 'pt-BR';

comment on column public.company_settings.locale is
  'Pais/idioma em que a loja atende: define o vocabulario e os termos legais (matricula x placa, IUC x IPVA). O idioma da RESPOSTA acompanha o cliente; isto aqui e a base. Valores: pt-BR, pt-PT, es-ES, en.';

alter table public.company_settings
  drop constraint if exists company_settings_locale_check;

alter table public.company_settings
  add constraint company_settings_locale_check
  check (locale in ('pt-BR', 'pt-PT', 'es-ES', 'en'));

-- Todas as lojas de hoje são brasileiras. O default cobre, mas deixar
-- explícito evita que uma linha antiga com nulo escape da constraint.
update public.company_settings set locale = 'pt-BR' where locale is null;
