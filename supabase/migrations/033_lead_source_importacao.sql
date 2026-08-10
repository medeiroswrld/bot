-- 033 — Origem do lead + público de campanha por origem
--
-- Motivo: importar a base antiga de clientes pra disparar campanha pra eles.
-- Sem separar a origem, 2.000 contatos importados caem na coluna "Novo" do
-- kanban e o vendedor perde a tela de trabalho.
--
-- `source` é um eixo DIFERENTE de `status`: status é a etapa do funil
-- (novo → atendimento → ... → vendido) e muda com o tempo; source é de onde a
-- pessoa veio e não muda nunca. Um lead pode ser 'importacao' E 'negociacao'.

alter table public.leads
  add column if not exists source text not null default 'manual';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leads_source_check'
  ) then
    alter table public.leads
      add constraint leads_source_check
      check (source in ('manual', 'whatsapp', 'importacao'));
  end if;
end $$;

-- Backfill: quem entrou pelo bot tem essa nota fixa (whatsapp-webhook).
update public.leads
   set source = 'whatsapp'
 where source = 'manual'
   and notes like '%automaticamente via WhatsApp%';

-- O público de campanha filtra por (user_id, source).
create index if not exists idx_leads_user_source
  on public.leads (user_id, source);

-- Novo público de campanha: mirar só a base importada, sem misturar com os
-- leads que o bot gerou.
alter table public.campaigns
  drop constraint if exists campaigns_audience_type_check;

alter table public.campaigns
  add constraint campaigns_audience_type_check
  check (audience_type in (
    'all_leads', 'leads_by_status', 'leads_inactive',
    'leads_by_interest_vehicle', 'custom_phones', 'leads_by_source'
  ));
