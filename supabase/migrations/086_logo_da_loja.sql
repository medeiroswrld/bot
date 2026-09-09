-- 086 — logo da loja no contrato
--
-- O contrato impresso saía sem identidade nenhuma. O da Leandrinho, feito no
-- Word, tem a logo no topo — e o gerado pelo sistema saía como texto corrido,
-- o que faz o documento parecer rascunho na frente do cliente que está
-- assinando.
--
-- Guarda só a URL: o arquivo vai pro Storage, no bucket `whatsapp-profiles`,
-- que já é público e já tem política. Bucket novo exigiria policy nova pra
-- guardar a mesma natureza de imagem — identidade visual da loja.
--
-- Usada pelo marcador {{logo}} do contrato (src/lib/contrato.js).

alter table public.company_settings
  add column if not exists logo_url text;

comment on column public.company_settings.logo_url is
  'Logo da loja, usada no marcador {{logo}} do contrato. Arquivo no Storage; aqui só a URL pública.';
