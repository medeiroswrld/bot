-- 039 — Cache de consulta de placa
--
-- Cada consulta ao fornecedor é PAGA. Os dados de um veículo (marca, modelo,
-- ano, cor) não mudam, então consultar a mesma placa duas vezes é dinheiro
-- jogado fora — e acontece direto: o lojista erra o preço, volta, refaz.
--
-- O cache é GLOBAL de propósito, não por tenant: a placa ABC1234 é o mesmo
-- carro para qualquer loja. Um carro que roda entre revendas é consultado uma
-- vez só. Por isso não há RLS de leitura por dono aqui — a tabela é acessada
-- apenas pela edge function com service role, nunca direto pelo cliente.

create table if not exists public.plate_lookups (
  plate         text        primary key,
  dados         jsonb       not null,
  consulted_by  uuid        references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

alter table public.plate_lookups enable row level security;

-- Sem policy de SELECT/INSERT para usuários: o acesso é só via service role.
-- (RLS ligado sem policy = ninguém com token de usuário lê ou escreve.)
