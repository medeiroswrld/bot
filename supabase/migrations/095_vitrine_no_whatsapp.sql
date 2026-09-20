-- 095 — como o estoque aparece no WhatsApp
--
-- Hoje a lista de carros sai como TEXTO: o bot escreve os veículos um embaixo
-- do outro. Com mais de três ou quatro vira textão, que é exatamente a
-- reclamação — "está ficando feio".
--
-- Entram duas formas melhores, e a diferença entre elas importa:
--
-- ── 1. Lista interativa (`lista_interativa`, LIGADA por padrão) ─────────────
--
-- Recurso nativo do WhatsApp: um botão que abre um menu rolável, com título e
-- descrição por item, e o cliente TOCA em vez de digitar. Não custa nada, não
-- passa por política de comércio e, o mais importante, NÃO DEPENDE DE
-- SINCRONIZAÇÃO — as linhas saem do banco no instante do envio, então a lista
-- nunca mostra carro vendido.
--
-- Limite de 10 linhas por mensagem, imposto pela Meta.
--
-- ── 2. Catálogo (`catalogo_habilitado`, DESLIGADO por padrão) ──────────────
--
-- A vitrine nativa do WhatsApp, com foto e preço. Bonita, e com um custo real:
-- exige catálogo criado no Commerce Manager, conectado à WABA, com os produtos
-- sincronizados. Passa a existir uma SEGUNDA verdade sobre o estoque — a nossa
-- e a da Meta — e quando elas divergem o cliente pede um carro que já foi
-- vendido.
--
-- Por isso nasce desligado e é escolha da loja, não padrão do sistema.
--
-- ── Por que estas colunas NÃO entram no trigger de proteção ────────────────
--
-- As colunas protegidas (plano, assinatura, suspensão) são decisão do dono do
-- sistema. Estas são decisão da LOJA sobre a própria vitrine — o lojista liga e
-- desliga quando quiser, e não há nada a ganhar impedindo isso.

alter table public.company_settings
  add column if not exists lista_interativa     boolean not null default true,
  add column if not exists catalogo_habilitado  boolean not null default false,
  add column if not exists catalogo_id          text;

comment on column public.company_settings.lista_interativa is
  'Menu interativo do WhatsApp para mostrar o estoque. Sai do banco na hora, entao nunca mostra carro vendido.';

comment on column public.company_settings.catalogo_habilitado is
  'Catalogo nativo do WhatsApp. Desligado por padrao: exige sincronizacao com o Commerce Manager, e catalogo desatualizado mostra carro que ja foi vendido.';

comment on column public.company_settings.catalogo_id is
  'ID do catalogo no Commerce Manager, conectado a WABA da loja.';
