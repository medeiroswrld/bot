-- 078 — uma visita por pessoa por horário
--
-- A checagem no código (process-conversation) resolve o caminho do bot. Este
-- índice fecha a porta no banco, que é onde a regra não depende de ninguém
-- lembrar dela: agendamento criado pela tela, por importação ou por um caminho
-- futuro cai na mesma trava.
--
-- Mesma lição da RLS por linha e do trigger de plano: guarda no servidor vale
-- mais do que verificação em quem chama.
--
-- Só vale para visitas VIVAS. Cancelada e não comparecida ficam de fora de
-- propósito — o cliente que cancelou e remarcou o mesmo horário é caso legítimo,
-- e o histórico não pode bloquear a agenda.

-- Limpa duplicatas existentes antes de criar o índice, senão ele não sobe.
-- Mantém a mais recente de cada grupo: se o vendedor remarcou, a última é a
-- que vale.
with ranqueadas as (
  select id,
         row_number() over (
           partition by user_id, customer_phone, appointment_date, appointment_time
           order by created_at desc
         ) as posicao
    from public.appointments
   where status in ('scheduled', 'confirmed')
     and customer_phone is not null
)
update public.appointments a
   set status = 'cancelled',
       notes  = coalesce(a.notes || ' | ', '') || 'duplicata removida automaticamente (migration 078)'
  from ranqueadas r
 where a.id = r.id
   and r.posicao > 1;

create unique index if not exists appointments_sem_duplicata
  on public.appointments (user_id, customer_phone, appointment_date, appointment_time)
  where status in ('scheduled', 'confirmed') and customer_phone is not null;
