-- ============================================================================
-- 121 — Visita sem horário marcado (feirão)
-- ============================================================================
--
-- Em dia de feirão, perguntar a hora ATRAPALHA. No fim de semana a pessoa não
-- sabe a que horas vai conseguir sair, trava na resposta e a conversa morre
-- sem agendamento nenhum. Melhor registrar que ela vem NAQUELE DIA e deixar a
-- hora em aberto — e isso ainda dá motivo pra loja mandar mensagem no dia 26
-- ("você marcou pra vir no dia 28").
--
-- POR QUE UMA COLUNA E NÃO appointment_time NULO:
-- `appointment_time` é NOT NULL e é lida por lembrete, agenda e relatório.
-- Afrouxar pra NULL obrigaria a revisar todo mundo que lê, e qualquer lugar
-- esquecido quebraria em produção. Com a coluna nova, quem não sabe dela
-- continua lendo um horário válido (a abertura do evento) e nada quebra; quem
-- sabe, mostra "dia todo".
--
-- Idempotente: pode ser reexecutada sem erro.
-- ============================================================================

alter table public.appointments
  add column if not exists sem_horario boolean not null default false;

comment on column public.appointments.sem_horario is
  'true = o cliente marcou o DIA, não a hora (feirão). appointment_time guarda a abertura do evento só para satisfazer o NOT NULL — não é hora combinada e não deve ser mostrada como tal.';

-- Índice parcial: as consultas que se importam com isto (agenda do evento,
-- lembrete) querem justamente as poucas linhas com a marca, não varrer tudo.
create index if not exists appointments_sem_horario_idx
  on public.appointments (user_id, appointment_date)
  where sem_horario;
