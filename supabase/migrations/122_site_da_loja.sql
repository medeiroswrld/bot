-- ============================================================================
-- 122 — Site da loja
-- ============================================================================
--
-- O cliente pergunta "vocês têm site?" e o bot não sabia responder — não
-- existia campo nenhum com o endereço. Ele então ou desconversava ou (pior)
-- arriscava um palpite.
--
-- Campo próprio e não FAQ: o site entra em várias respostas diferentes
-- ("manda o link", "quero ver o estoque", "tem mais fotos?"), e como FAQ ele
-- só sairia quando a pergunta batesse com o texto cadastrado.
--
-- Idempotente: pode ser reexecutada sem erro.
-- ============================================================================

alter table public.company_settings
  add column if not exists site_url text;

comment on column public.company_settings.site_url is
  'Endereço do site da loja. Vazio = o bot NUNCA menciona site (e não inventa um).';
