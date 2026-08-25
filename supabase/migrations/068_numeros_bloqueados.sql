-- 068 — números que o bot nunca responde
--
-- Casos reais: o número da própria equipe, o do dono, o do contador, o do
-- guincho, o fornecedor que manda foto de carro toda semana. Hoje o bot atende
-- todos como se fossem cliente — apresenta a loja, pergunta o nome, tenta
-- agendar visita.
--
-- Além do constrangimento, cada uma dessas conversas custa token e polui o
-- funil com lead que nunca foi lead.
--
-- Diferente de `team_members` (044), que serve só para o bot RECONHECER a
-- equipe dentro da conversa. Aqui ele não responde, ponto.

alter table public.company_settings
  add column if not exists bot_blocked_numbers jsonb not null default '[]'::jsonb;

comment on column public.company_settings.bot_blocked_numbers is
  'Telefones que o bot nunca responde. Guardados só com dígitos; a comparação ignora DDI e o nono dígito.';
