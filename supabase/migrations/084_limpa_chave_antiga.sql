-- 084 — remove a chave única antiga de conversations
--
-- Contexto, pra quem ler isso daqui a seis meses:
--
-- A 083 trocou a chave única de (user_id, channel, customer_phone) para incluir
-- o phone_number_id. Mas o deploy das functions estava bloqueado por um token
-- expirado, e a migration foi aplicada antes do código correspondente subir.
--
-- Resultado: o webhook em produção seguia usando o `onConflict` de 3 colunas,
-- que não casava com nenhuma constraint. Postgres devolve 42P10, o upsert
-- falha, e a mensagem do cliente é descartada em silêncio.
--
-- A correção de emergência foi recriar a chave antiga, deixando as duas
-- conviverem: a antiga fazia o código velho funcionar, a nova ficava esperando.
--
-- Agora o código novo está no ar (whatsapp-webhook v65), e a antiga passou de
-- rede de segurança a estorvo: com 3 colunas, ela IMPEDE o mesmo cliente de ter
-- conversa em dois números da mesma loja — que é exatamente o que a 083 veio
-- permitir.
--
-- ── A lição, que vale mais que a migration ─────────────────────────────────
--
-- Migration que mexe em chave ou índice EXISTENTE não pode ser aplicada antes
-- do código que a acompanha. Só migration puramente aditiva (coluna nova,
-- tabela nova) é segura sozinha.

alter table public.conversations
  drop constraint if exists conversations_user_channel_phone_key;

-- Conferência: tem que sobrar só a de 4 colunas.
do $$
declare
  n int;
begin
  select count(*) into n
    from pg_constraint
   where conrelid = 'public.conversations'::regclass
     and contype = 'u';
  raise notice 'constraints unicas em conversations: %', n;
end $$;
