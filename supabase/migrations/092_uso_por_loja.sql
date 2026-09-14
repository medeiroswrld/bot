-- 092 — consumo do mês de todas as lojas, numa consulta só
--
-- O painel do administrador precisa mostrar "118 de 250" ao lado de cada loja.
-- Chamar `conversas_do_mes` uma vez por loja funciona com cinco clientes e vira
-- cinquenta viagens ao banco com cinquenta — o tipo de coisa que só dói quando
-- o negócio dá certo.
--
-- Sem checagem de administrador aqui de propósito: quem decide isso é a edge
-- function `admin-metrics`, que confere o e-mail contra o secret ADMIN_EMAILS
-- antes de usar a service_role. Repetir a regra em dois lugares só criaria
-- duas verdades que um dia divergem.
create or replace function public.admin_uso_do_mes(p_ref date default current_date)
returns table (user_id uuid, conversas int)
language sql
stable
security definer
set search_path = ''
as $$
  select u.user_id, count(distinct u.conversation_id)::int
    from public.llm_usage u
   where u.created_at >= date_trunc('month', p_ref)
     and u.created_at <  date_trunc('month', p_ref) + interval '1 month'
   group by u.user_id;
$$;
