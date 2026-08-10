-- 034 — Classificação manual de cliente novo/antigo
--
-- A régua padrão é a data de cadastro (30 dias). Ela quebra na importação: um
-- cliente de 2019 que o lojista importa hoje entra com created_at de hoje e
-- conta como "novo" por um mês — exatamente ao contrário do que ele é.
--
-- `client_type` é um OVERRIDE opcional. NULL (o normal) = calcula pela data,
-- que é o comportamento de todo lead que o bot cria. Preenchido = vale o que o
-- lojista disse. Não mexemos em created_at pra isso: a data de criação do
-- registro é um fato, e falsificá-la estragaria ordenação e auditoria.

alter table public.leads
  add column if not exists client_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leads_client_type_check'
  ) then
    alter table public.leads
      add constraint leads_client_type_check
      check (client_type is null or client_type in ('novo', 'antigo'));
  end if;
end $$;
