-- 065 — despesas fixas (modelo, não lançamento)
--
-- Salário, aluguel, contabilidade e internet repetem todo mês. Digitar de novo
-- é trabalho bobo e é onde o lojista desiste do módulo.
--
-- Mas a saída NÃO é gerar lançamentos futuros automaticamente. Conta de luz
-- muda de valor, funcionário entra e sai, e um caixa cheio de lançamento
-- adivinhado é pior que um caixa vazio: quem confere descobre que o número não
-- é real e para de olhar.
--
-- Então isto aqui é um MODELO. Quando o mês chega, a loja lança as fixas de uma
-- vez e ajusta o que veio diferente antes de confirmar. O `ref` do lançamento
-- gerado é "fixo:<id>:<AAAA-MM>", o que impede lançar o mesmo mês duas vezes —
-- inclusive por dois usuários da mesma loja clicando junto.

create table if not exists public.recurring_expenses (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  categoria  text        not null,
  valor      numeric     not null check (valor >= 0),
  descricao  text,
  -- Dia do vencimento, só informativo: serve pra ordenar e pra loja se
  -- reconhecer na lista. Não dispara nada.
  dia        smallint    check (dia between 1 and 31),
  ativo      boolean     not null default true,
  created_at timestamptz not null default now()
);

create index if not exists recurring_expenses_user_idx
  on public.recurring_expenses (user_id) where ativo;

alter table public.recurring_expenses enable row level security;

drop policy if exists "recurring_expenses_own" on public.recurring_expenses;
create policy "recurring_expenses_own"
  on public.recurring_expenses for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.recurring_expenses is
  'Modelo de despesa que repete todo mês. Não gera lançamento sozinha: a loja lança o mês e ajusta o que mudou.';
