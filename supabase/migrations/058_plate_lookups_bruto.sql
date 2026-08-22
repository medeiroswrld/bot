-- 058 — guarda a resposta crua da consulta de placa
--
-- O cache guardava só os campos já normalizados (marca, modelo, ano, cor,
-- combustível). Todo o resto que o fornecedor manda — ano do modelo, município,
-- UF, cilindradas, segmento — era descartado depois de usar.
--
-- O problema é o custo assimétrico: descartar é grátis agora, mas recuperar
-- significa consultar a placa DE NOVO e pagar de novo, a 20 consultas por dia.
-- Quando o ano do modelo virar obrigatório (a Webmotors pede fabricação e
-- modelo separados), o estoque inteiro teria que ser reconsultado.
--
-- Guardar o JSON cru custa alguns KB por placa e torna isso uma releitura.

alter table public.plate_lookups
  add column if not exists bruto jsonb;

comment on column public.plate_lookups.bruto is
  'Resposta crua do fornecedor, como veio. Serve para extrair campos novos sem reconsultar (e pagar) a placa.';
