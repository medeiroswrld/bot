-- 064 — financeiro: custo por veículo e livro-caixa da loja
--
-- Uma tabela só, com `car_id` OPCIONAL. É o que faz as duas telas saírem do
-- mesmo dado: com car_id a despesa gruda no veículo (peça, preparação,
-- legalização) e entra no lucro daquele carro; sem car_id é despesa de
-- operação (aluguel, energia, contabilidade).
--
-- A mesma linha aparece nos dois lugares — uma peça de R$ 800 no Onix está no
-- custo do Onix E na linha "Manutenção Veículos" do mês. Não é duplicidade: é o
-- mesmo lançamento visto por dois ângulos. Duas tabelas separadas obrigariam a
-- lançar duas vezes, e o lojista lançaria só numa.
--
-- NÃO existe tabela de categorias. Categoria é texto, com uma lista padrão no
-- app e o que a loja já usou virando sugestão. Tabela de categorias exigiria
-- tela de cadastro para um dado que muda uma vez por ano.

-- ── Quanto a loja pagou no veículo ───────────────────────────────────────────
-- Sem isto não existe lucro, não existe a linha "Compra de Veículos" e não
-- existe base de cálculo para nota fiscal de usado, que incide sobre a margem.
alter table public.cars
  add column if not exists purchase_price numeric;

comment on column public.cars.purchase_price is
  'Quanto a loja pagou neste veículo. Base do lucro real e da margem para fins fiscais.';

-- ── Lançamentos ──────────────────────────────────────────────────────────────
create table if not exists public.financial_entries (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  car_id     uuid        references public.cars(id) on delete set null,
  tipo       text        not null check (tipo in ('receita', 'despesa')),
  categoria  text        not null,
  valor      numeric     not null check (valor >= 0),
  descricao  text,
  data       date        not null default current_date,

  -- Lançamento que o sistema criou sozinho a partir de uma venda ou de uma
  -- compra. Precisa ser distinguível: se o lojista digitar a mesma venda à mão
  -- o mês fecha com o dobro, e um relatório que mente uma vez não é mais aberto.
  origem     text        not null default 'manual' check (origem in ('manual', 'automatico')),

  -- Chave de idempotência do automático ("venda:<car_id>", "compra:<car_id>").
  -- Vender, desfazer e vender de novo não pode gerar dois lançamentos.
  ref        text,

  created_at timestamptz not null default now()
);

create unique index if not exists financial_entries_ref_key
  on public.financial_entries (user_id, ref)
  where ref is not null;

create index if not exists financial_entries_user_data_idx
  on public.financial_entries (user_id, data desc);

create index if not exists financial_entries_car_idx
  on public.financial_entries (car_id)
  where car_id is not null;

alter table public.financial_entries enable row level security;

drop policy if exists "financial_entries_own" on public.financial_entries;
create policy "financial_entries_own"
  on public.financial_entries for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.financial_entries is
  'Lançamentos financeiros da loja. Com car_id, o gasto entra no custo daquele veículo; sem car_id, é despesa de operação.';
