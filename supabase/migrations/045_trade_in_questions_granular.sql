-- 045 — Liga/desliga cada pergunta da pré-avaliação de troca
--
-- Antes era tudo-ou-nada (trade_in_evaluation_enabled). Mas pergunta que cai
-- bem numa loja soa estranha em outra: "que nota de 0 a 10 você daria pro seu
-- carro?" funciona onde o vendedor já usa isso presencialmente, e em outra
-- concessionária o cliente estranha.
--
-- Mesmo formato do ford_qualification: objeto de booleanos. Ausente ou null =
-- tudo ligado, pra não mudar comportamento de quem já usa.
alter table public.company_settings
  add column if not exists trade_in_questions jsonb not null default
    '{"modelo":true,"ano":true,"km":true,"tempo_dono":true,"nota":true,"pagamento":true}'::jsonb;

comment on column public.company_settings.trade_in_questions is
  'Quais perguntas da pré-avaliação de troca o bot faz. Chaves: modelo, ano, km, tempo_dono, nota, pagamento. false = não pergunta.';
