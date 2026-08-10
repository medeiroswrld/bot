-- 036 — Preenche o nome das conversas que nasceram sem ele
--
-- As conversas criadas pelo disparo de campanha ficaram como "Sem nome" por um
-- bug já corrigido (o insert em campaign_sends não trazia customer_name, então
-- o registro da conversa recebia undefined). Este script conserta o que já foi
-- gravado; disparos novos já nascem certos.
--
-- O casamento NÃO é por telefone literal: o mesmo cliente pode estar como
-- 5515996311510 num lado e 551596311510 no outro (nono dígito). Compara-se a
-- forma canônica — país+DDD (4 primeiros) e os 8 últimos dígitos —, que é a
-- mesma regra usada em src/lib/phone.js.

with numeros as (
  select
    l.user_id,
    l.name,
    regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') as d
  from public.leads l
  where l.phone is not null
    and coalesce(btrim(l.name), '') <> ''
),
canonico as (
  select user_id, name, left(d, 4) as ddd, right(d, 8) as fim
  from numeros
  where length(d) >= 12          -- só números já com código do país
)
update public.conversations c
   set customer_name = k.name
  from canonico k
 where c.user_id = k.user_id
   and coalesce(btrim(c.customer_name), '') = ''      -- não sobrescreve nome existente
   and left(regexp_replace(c.customer_phone, '\D', '', 'g'), 4) = k.ddd
   and right(regexp_replace(c.customer_phone, '\D', '', 'g'), 8) = k.fim;

-- Conferência (rode separado se quiser ver o resultado):
-- select count(*) filter (where coalesce(btrim(customer_name),'') = '') as sem_nome,
--        count(*) as total
--   from public.conversations;
