-- 101 — as vendas que passaram pelo assistente
--
-- Eu tinha deixado isto de fora da 100, com o argumento de que a atribuição
-- mostraria zero. Medindo, o argumento caiu: das 26 vendas da DSC em 180 dias,
-- 11 têm telefone do comprador anotado — e as 11 casam com uma conversa. Cem
-- por cento. E as 11 tiveram o assistente conversando.
--
-- O que falhava não era a atribuição, era o PREENCHIMENTO: 15 vendas sem
-- telefone do comprador não podem ser ligadas a nada.
--
-- ── O que esta view afirma, e o que NÃO afirma ─────────────────────────────
--
-- Afirma: esta pessoa conversou com a loja pelo sistema, o assistente
-- participou, e depois comprou um carro.
--
-- NÃO afirma que o assistente causou a venda. A diferença não é preciosismo —
-- é o que separa um número que o lojista confere e confirma de um número que
-- ele desmente na primeira olhada, levando o resto do painel junto. Por isso a
-- tela diz "clientes atendidos que compraram", nunca "vendas geradas".
--
-- ── Por que casar pelos 8 últimos dígitos ──────────────────────────────────
--
-- O telefone entra de três jeitos diferentes: digitado na venda, vindo do
-- WhatsApp com 55 na frente, e com ou sem o 9 extra. Comparar inteiro perderia
-- quase tudo. Os 8 últimos são estáveis em qualquer um dos formatos.
--
-- O risco conhecido: quem compra às vezes é outra pessoa da casa, e aí o
-- telefone não bate. Isso faz a conta ERRAR PARA MENOS, que é o lado certo de
-- errar num número que serve para cobrar.

create or replace view public.vendas_do_assistente as
select v.user_id,
       v.id            as car_id,
       v.brand,
       v.model,
       v.buyer_name,
       v.price,
       v.sold_at,
       c.id            as conversa_id,
       c.channel
  from public.cars v
  join public.conversations c
    on c.user_id = v.user_id
   and length(regexp_replace(coalesce(v.buyer_phone, ''), '[^0-9]', '', 'g')) >= 10
   and right(regexp_replace(c.customer_phone, '[^0-9]', '', 'g'), 8)
     = right(regexp_replace(v.buyer_phone, '[^0-9]', '', 'g'), 8)
 where v.status = 'sold'
   and v.sold_at is not null
   -- O assistente precisa ter falado nessa conversa. Sem isto, venda de
   -- cliente que só trocou mensagem com o vendedor entraria na conta.
   and exists (select 1 from public.messages m
                where m.conversation_id = c.id and m.role = 'bot');

comment on view public.vendas_do_assistente is
  'Vendas cujo comprador conversou com a loja pelo sistema, com o assistente participando. Afirma coincidencia, NAO causalidade — a tela diz "clientes atendidos que compraram", nunca "vendas geradas".';

alter view public.vendas_do_assistente set (security_invoker = on);

-- Quantas vendas ficaram de fora por falta de telefone. Mostrar isso ao
-- lojista transforma o buraco em instrução: ele preenche, e o próprio número
-- dele melhora no mês seguinte.
create or replace view public.vendas_sem_telefone as
  select user_id, count(*) as quantidade
    from public.cars
   where status = 'sold'
     and sold_at > now() - interval '180 days'
     and length(regexp_replace(coalesce(buyer_phone, ''), '[^0-9]', '', 'g')) < 10
   group by user_id;

comment on view public.vendas_sem_telefone is
  'Vendas que nao puderam ser ligadas a nenhuma conversa porque o telefone do comprador nao foi anotado.';

alter view public.vendas_sem_telefone set (security_invoker = on);
