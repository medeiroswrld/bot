-- 075 — dois acertos depois de ver o Gerenciador de Eventos por dentro
--
-- 1. QualifiedLead → LeadSubmitted
--
--    A documentação lista `QualifiedLead` entre os eventos aceitos, mas o
--    assistente do Gerenciador não oferece esse nome em lugar nenhum — a lista
--    tem LeadSubmitted, Contato e InitiateCheckout, e nada de QualifiedLead.
--
--    Mandar um nome que o dataset não conhece não dá erro: o evento entra como
--    desconhecido e não serve pra otimização. Ou seja, funcionaria na aparência
--    e não funcionaria de verdade. Melhor usar o nome que a interface reconhece.
--
-- 2. Nada de dados a migrar: a fila estava vazia (o teste foi limpo).

create or replace function public.enfileira_capi_do_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref_id uuid;
  v_valor  numeric;
begin
  select r.id into v_ref_id
    from public.ad_referrals r
   where r.lead_id = new.id
     and r.ctwa_clid is not null
   order by r.created_at desc
   limit 1;

  if v_ref_id is null then
    return new;
  end if;

  if new.status in ('proposta', 'negociacao', 'vendido') then
    insert into public.capi_events (user_id, lead_id, ad_referral_id, event_name, event_time)
    values (new.user_id, new.id, v_ref_id, 'LeadSubmitted', now())
    on conflict (lead_id, event_name) do nothing;
  end if;

  if new.status = 'vendido' then
    select c.sold_price into v_valor
      from public.cars c
     where c.id = new.sold_car_id;

    insert into public.capi_events
      (user_id, lead_id, ad_referral_id, event_name, event_time, valor)
    values
      (new.user_id, new.id, v_ref_id, 'Purchase',
       coalesce(new.sold_at, now()), v_valor)
    on conflict (lead_id, event_name) do nothing;
  end if;

  return new;
end;
$$;

-- Qualquer evento que já tenha sido enfileirado com o nome antigo passa a valer
-- com o novo. Hoje não há nenhum, mas isto torna a migration segura se ela for
-- aplicada fora de ordem em outro ambiente.
update public.capi_events
   set event_name = 'LeadSubmitted'
 where event_name = 'QualifiedLead'
   and status = 'pendente';
