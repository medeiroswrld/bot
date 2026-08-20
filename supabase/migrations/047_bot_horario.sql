-- 047 — Liga/desliga do bot e janela de horário
--
-- Loja que tem equipe de dia e quer o bot só fora do expediente: "responde das
-- 18h às 8h da manhã". Hoje o bot responde sempre, e a unica forma de calar era
-- assumir conversa por conversa.
--
-- Duas coisas separadas de proposito:
--  - bot_enabled: chave mestra. Desligada, o bot nao responde nunca.
--  - bot_schedule_*: janela. So vale se a chave mestra estiver ligada.
alter table public.company_settings
  add column if not exists bot_enabled boolean not null default true,
  add column if not exists bot_schedule_enabled boolean not null default false,
  add column if not exists bot_start time not null default '08:00',
  add column if not exists bot_end   time not null default '18:00';

comment on column public.company_settings.bot_enabled is
  'Chave mestra do bot. false = nao responde nunca, independente de horario.';
comment on column public.company_settings.bot_schedule_enabled is
  'true = o bot so responde dentro da janela bot_start..bot_end (fuso America/Sao_Paulo).';
comment on column public.company_settings.bot_start is
  'Inicio da janela. Se for MAIOR que bot_end, a janela atravessa a meia-noite (ex: 18:00 as 08:00).';
