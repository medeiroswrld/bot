-- 040 — Índices das consultas que rodam a cada mensagem
--
-- Motivo: E/S de disco em 86% com CPU em 22% e um banco de 135 MB. Essa
-- combinação — muito I/O, pouca CPU, base pequena — é assinatura de varredura
-- de tabela repetida, não de volume. No plano gratuito o I/O é crédito de
-- burst: quando acaba, tudo passa a estourar "tempo limite de conexão".
--
-- Postgres NÃO cria índice automático em coluna de chave estrangeira (só em PK
-- e UNIQUE). Todas as buscas abaixo estavam sem índice e rodam no caminho mais
-- quente do sistema.

-- Toda mensagem recebida busca o lead por telefone (no webhook, pra criar se
-- não existir) e de novo a cada turno do bot (pro bloco de qualificação).
-- Piorou quando a base de leads cresceu com a importação de clientes antigos.
create index if not exists idx_leads_user_phone
  on public.leads (user_id, phone)
  where phone is not null;

-- consultar_estoque roda em quase toda conversa e filtra por dono + status.
create index if not exists idx_cars_user_status
  on public.cars (user_id, status);

-- Cada envio de mídia lê as fotos do carro; car_id é FK, então não tinha índice.
create index if not exists idx_car_images_car
  on public.car_images (car_id);

-- Checagem de horário livre: lê os agendamentos do dia a cada pedido de visita.
create index if not exists idx_appointments_user_date
  on public.appointments (user_id, appointment_date);

-- Atualiza as estatísticas pro planner passar a usar os índices novos.
analyze public.leads;
analyze public.cars;
analyze public.car_images;
analyze public.appointments;
