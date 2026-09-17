-- 093 — vários modelos de contrato por loja
--
-- Até aqui existia UM modelo por loja, no campo `company_settings.contract_template`.
-- Serve enquanto a loja só vende para consumidor final; não serve no dia em que
-- ela precisa de um contrato de repasse — venda para outro lojista, que tem
-- partes, garantias e responsabilidades diferentes.
--
-- ── Por que tabela, e não uma segunda coluna ────────────────────────────────
--
-- `contract_template_repasse` resolveria hoje e cobraria o preço amanhã: o
-- terceiro estilo (procuração, recibo de sinal, autorização de venda) exigiria
-- outra coluna, outra migration e outro `if` em cada uma das três telas que
-- geram contrato. Lista resolve os três de uma vez.
--
-- ── A coluna antiga NÃO é removida ──────────────────────────────────────────
--
-- Ela fica como estava, com o conteúdo intacto. Duas razões, e a segunda é a
-- que importa: migration e deploy do front não sobem juntos, e neste projeto
-- isso já derrubou produção duas vezes. Enquanto a tela nova não estiver no ar,
-- a antiga continua lendo a coluna e imprimindo contrato normalmente. Remover
-- vira decisão de outro dia, depois de a lista estar rodando.

create table if not exists public.contract_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  nome        text not null,
  html        text not null,
  -- Marca qual sai selecionado por padrão na hora de gerar.
  padrao      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.contract_templates is
  'Modelos de contrato da loja (compra e venda, repasse, etc). Substitui company_settings.contract_template, que fica como estava ate a tela nova estar no ar.';

create index if not exists contract_templates_user_idx
  on public.contract_templates (user_id, created_at);

-- Um padrão por loja, garantido pelo banco. Sem isto, duas linhas marcadas
-- deixariam a tela escolhendo por ordem de retorno — que muda sozinha.
create unique index if not exists contract_templates_um_padrao
  on public.contract_templates (user_id)
  where padrao;

-- ── RLS: cada loja enxerga e edita só os seus ───────────────────────────────
alter table public.contract_templates enable row level security;

drop policy if exists contract_templates_leitura on public.contract_templates;
create policy contract_templates_leitura on public.contract_templates
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists contract_templates_insere on public.contract_templates;
create policy contract_templates_insere on public.contract_templates
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists contract_templates_atualiza on public.contract_templates;
create policy contract_templates_atualiza on public.contract_templates
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists contract_templates_apaga on public.contract_templates;
create policy contract_templates_apaga on public.contract_templates
  for delete to authenticated using (auth.uid() = user_id);

-- ── O que já existe vira o primeiro item da lista ───────────────────────────
--
-- Só para quem TEM modelo salvo. Loja que nunca personalizou continua caindo no
-- MODELO_PADRAO do código, como sempre — copiar o padrão para dentro do banco
-- congelaria a versão de hoje e ela deixaria de receber melhorias.
insert into public.contract_templates (user_id, nome, html, padrao)
select cs.user_id, 'Compra e venda', cs.contract_template, true
  from public.company_settings cs
 where coalesce(cs.contract_template, '') <> ''
   and not exists (
     select 1 from public.contract_templates t where t.user_id = cs.user_id
   );

-- Mantém `updated_at` honesto sem a tela precisar lembrar de mandar.
create or replace function public.toca_contract_template()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_contract_templates_updated on public.contract_templates;
create trigger trg_contract_templates_updated
  before update on public.contract_templates
  for each row execute function public.toca_contract_template();
