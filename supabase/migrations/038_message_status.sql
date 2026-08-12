-- 038 — Status de entrega/leitura das mensagens do bot (os "vistos" do WhatsApp)
--
-- A Meta manda webhooks de status (sent → delivered → read) referenciando o
-- `wamid` da mensagem. Já recebíamos esses eventos, mas só olhávamos os de
-- campanha; para as mensagens do bot o wamid nem era guardado (a coluna
-- wa_message_id só era preenchida no que CHEGAVA do cliente).
--
-- Com isso o lojista passa a ver se o cliente leu — que é a diferença entre
-- "ele está ignorando" e "ele nem viu ainda", e muda o que fazer a seguir.

alter table public.messages
  add column if not exists wa_status text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_wa_status_check'
  ) then
    alter table public.messages
      add constraint messages_wa_status_check
      check (wa_status is null or wa_status in ('sent', 'delivered', 'read', 'failed'));
  end if;
end $$;

-- O webhook de status busca a mensagem pelo wamid; sem índice isso vira
-- varredura da tabela inteira a cada evento (são 3 por mensagem enviada).
create index if not exists idx_messages_wa_message_id
  on public.messages (wa_message_id)
  where wa_message_id is not null;
