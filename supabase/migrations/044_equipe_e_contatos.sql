-- 044 — Equipe da loja e contatos por setor
--
-- Dois buracos que apareciam na conversa real:
--
-- 1. O cliente cita alguém da loja ("falei com o Rodrigo") e o bot não faz
--    ideia de quem é. Hoje ele improvisa, o que soa como se a loja não
--    conhecesse o próprio time.
--
-- 2. Concessionária divide função por número: vendas num, administrativo
--    noutro, consignação noutro. O bot é o de vendas, mas o cliente chega
--    perguntando de consignação e ele não tem o que passar.
--
-- jsonb em vez de tabela: são listas curtas (10-20 itens), sempre lidas
-- inteiras junto com o resto de company_settings, e nunca consultadas por
-- item. Tabela separada custaria um join em toda montagem de prompt sem
-- ganhar nada.
alter table public.company_settings
  add column if not exists team_members jsonb not null default '[]'::jsonb,
  add column if not exists department_contacts jsonb not null default '[]'::jsonb;

comment on column public.company_settings.team_members is
  'Equipe da loja: [{"nome":"Rodrigo","funcao":"Vendedor"}]. O bot confirma quem trabalha ali quando o cliente cita um nome.';

comment on column public.company_settings.department_contacts is
  'Contatos por setor: [{"setor":"Consignação","telefone":"15 99999-0000","quando_usar":"cliente quer deixar o carro para a loja vender"}]. O quando_usar é o gatilho que o bot usa para escolher o setor certo.';
