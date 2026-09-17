-- 094 — a lista guarda só os modelos ADICIONAIS
--
-- A 093 copiou o contrato de cada loja para dentro de `contract_templates`,
-- pensando em mover tudo para a lista. O desenho certo é outro, e mais simples:
--
--   `company_settings.contract_template`  → o contrato da loja, como sempre foi
--   `contract_templates`                  → os modelos A MAIS, com nome próprio
--
-- O motivo é de produto, não técnico. O lojista já tem um contrato colado ali,
-- funcionando. Mover aquilo para uma lista muda um lugar que ele conhece para
-- resolver um problema que é nosso, não dele. O que ele pediu foi "mais um
-- campo" — então o campo antigo fica onde está e a lista carrega só o que vem
-- depois dele.
--
-- Esta migration apaga as cópias que a 093 criou, e SÓ elas: a comparação é
-- pelo conteúdo. Cópia idêntica ao contrato da loja é duplicata e sairia duas
-- vezes no seletor da venda, com o mesmo texto e nomes diferentes. Modelo que
-- alguém tenha criado ou editado desde então não é tocado.
delete from public.contract_templates t
 using public.company_settings cs
 where cs.user_id = t.user_id
   and t.html = cs.contract_template;

comment on table public.contract_templates is
  'Modelos de contrato ADICIONAIS da loja (repasse, etc). O contrato principal continua em company_settings.contract_template.';
