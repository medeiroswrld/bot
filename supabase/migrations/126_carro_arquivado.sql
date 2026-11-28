-- ============================================================================
-- 126 — Carro arquivado
-- ============================================================================
--
-- ── O caso real ───────────────────────────────────────────────────────────
--
-- Carro consignado: o dono tira do pátio e às vezes devolve semanas depois.
-- Hoje a loja só tem dois caminhos, e os dois estão errados:
--
--   • deixar no estoque — o bot continua oferecendo um carro que não está lá,
--     e o site continua anunciando. O cliente vem ver e o carro não existe.
--   • excluir — perde foto, histórico, preço, a ficha. Quando o carro volta,
--     é cadastrar tudo de novo.
--
-- Arquivar resolve: sai de toda vitrine, o cadastro fica inteiro, e voltar é
-- um clique.
--
-- ── Por que um status, e não uma coluna `arquivado` ───────────────────────
--
-- Os dois maiores leitores do estoque — o bot (`process-conversation`) e o
-- feed do site (`estoque-publico`) — filtram por LISTA BRANCA:
--
--     .in('status', ['available', 'reserved'])
--
-- Então um valor novo de `status` já nasce fora dos dois, sem tocar em
-- nenhuma das duas funções. Uma coluna booleana à parte exigiria lembrar de
-- somar `and not arquivado` em cada leitor — e o leitor esquecido falharia em
-- SILÊNCIO, com o bot oferecendo um carro que não está no pátio. Essa é a
-- falha que este projeto já pagou caro várias vezes.
--
-- `sold` continua sendo coisa diferente: vendido é desfecho e alimenta o
-- faturamento; arquivado é pausa e não significa nada de venda.
--
-- Idempotente: pode ser reexecutada sem erro.
-- ============================================================================

alter table public.cars
  drop constraint if exists cars_status_check;

alter table public.cars
  add constraint cars_status_check
  check (status in ('available', 'reserved', 'sold', 'incoming', 'arquivado'));

comment on column public.cars.status is
  'available = à venda · reserved = reservado · sold = vendido (desfecho, conta no faturamento) · incoming = chegou na troca, sem preço · arquivado = fora do pátio temporariamente (consignado que o dono levou). Bot e feed do site leem por lista branca em (available, reserved), então só esses dois aparecem pro cliente.';
