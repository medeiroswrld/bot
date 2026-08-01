-- ============================================================================
-- 031_seed_default_templates.sql
--
-- PROBLEMA: templates padrão só existiam para tenants criados antes de cada
-- migração de seed (ver 024, que já avisava: "tenants novos devem receber este
-- template no fluxo de cadastro"). Nunca foi feito — a conta criada em 01/08
-- nasceu com ZERO templates e o cliente não tinha o que enviar pra aprovação.
--
-- SOLUÇÃO (3 partes):
--   1. Função seed_default_templates(user_id) — fonte única dos templates padrão
--   2. Trigger de signup (handle_new_user) passa a chamá-la → toda conta NOVA
--      já nasce com os 5 templates em 'draft', prontos pro botão "Enviar pra
--      aprovação" assim que o WhatsApp for conectado
--   3. Backfill de todas as contas existentes
--
-- BÔNUS: corrige o feirao_de_carros, gravado com acentos corrompidos (mojibake)
-- por um script PowerShell em 01/08.
--
-- A ordem das variáveis {{n}} NÃO pode mudar — as edge functions de envio
-- dependem dela:
--   lembrete_visita     {{1}} nome  {{2}} horário  {{3}} empresa  {{4}} endereço
--   veiculo_disponivel  {{1}} nome  {{2}} modelo   {{3}} empresa  {{4}} descrição
--   aniversario_cliente {{1}} nome  {{2}} empresa
--
-- Idempotente: pode ser reexecutada sem erro.
-- ============================================================================

-- ─── 1. Corrige o feirão corrompido (mojibake: 'Ã' onde deveria ter acento) ──
-- Volta pra 'draft' e limpa o meta_template_id: a versão que está na Meta tem o
-- texto quebrado e precisa ser apagada lá antes de reenviar.

update public.message_templates
set header_content = 'Feirão de Carros',
    body_text = 'Oi, {{1}}! Tudo bem? 😊

Vem aí o nosso *Feirão de Carros*: {{2}}, aqui na loja, com condições que não aparecem todo dia — {{3}}.

Vai ser por ordem de chegada e os melhores carros saem primeiro. Quer que eu já separe um atendimento pra você? É só responder essa mensagem. 🚗',
    footer_text = 'Pra não receber mais ofertas, responda SAIR.',
    body_variables = '[{"name":"primeiro_nome","example":"João"},{"name":"data_evento","example":"sábado, dia 25/07, a partir das 9h"},{"name":"condicoes","example":"entrada facilitada, taxa reduzida e avaliação do seu usado na hora"}]'::jsonb,
    status = 'draft',
    meta_template_id = null,
    rejection_reason = null,
    submitted_at = null
where meta_template_name = 'feirao_de_carros'
  and (body_text like '%' || chr(195) || '%' or coalesce(header_content, '') like '%' || chr(195) || '%');

-- ─── 2. Fonte única dos templates padrão ────────────────────────────────────

create or replace function public.seed_default_templates(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_inserted integer;
begin
  insert into public.message_templates
    (user_id, meta_template_name, display_name, category, language,
     header_type, header_content, body_text, body_variables, footer_text, buttons, status)
  select
    p_user_id, t.nome, t.titulo, t.categoria, 'pt_BR',
    t.header_type, t.header_content, t.corpo,
    t.variaveis::jsonb, t.rodape, t.botoes::jsonb, 'draft'
  from (values
    (
      'lembrete_visita', 'Lembrete de Visita', 'UTILITY',
      null::text, null::text,
      $t$Oi {{1}}! Tá chegando o horário da sua visita às {{2}}.

Estamos te esperando aqui na {{3}}. 📍 {{4}}

Qualquer coisa é só me chamar! 😊$t$,
      $v$[{"name":"primeiro_nome","example":"João"},{"name":"horario","example":"14h"},{"name":"nome_empresa","example":"Auto Prime Seminovos"},{"name":"endereco","example":"Av. Brasil, 1000 - Centro"}]$v$,
      null::text, '[]'
    ),
    (
      'veiculo_disponivel', 'Aviso de veículo disponível', 'UTILITY',
      null::text, null::text,
      $t$Olá {{1}}! Você nos pediu para avisar quando entrasse um {{2}} aqui na {{3}}. Acabou de chegar: {{4}}. Quer ver os detalhes?$t$,
      $v$[{"name":"primeiro_nome","example":"João"},{"name":"modelo_procurado","example":"Honda Civic 2010"},{"name":"nome_empresa","example":"Auto Prime Seminovos"},{"name":"descricao_carro","example":"Honda Civic LX 2010, 78 mil km, R$ 52.000"}]$v$,
      null::text, '[]'
    ),
    (
      'aniversario_cliente', 'Aniversário do cliente', 'MARKETING',
      null::text, null::text,
      $t$Olá {{1}}! Aqui da {{2}} a gente quer te desejar um feliz aniversário 🎉 Que seu dia seja muito especial.$t$,
      $v$[{"name":"primeiro_nome","example":"João"},{"name":"nome_empresa","example":"Auto Prime Seminovos"}]$v$,
      null::text, '[]'
    ),
    (
      'reativacao_cliente', 'Reativação de cliente', 'MARKETING',
      null::text, null::text,
      $t$Oi {{1}}, aqui é da {{2}}. Faz um tempo que a gente não se fala. Quer dar uma olhada nas opções de carros que temos disponíveis hoje?$t$,
      $v$[{"name":"primeiro_nome","example":"João"},{"name":"nome_empresa","example":"Auto Prime Seminovos"}]$v$,
      null::text, '[]'
    ),
    (
      'feirao_de_carros', 'Feirão de Carros - Convite', 'MARKETING',
      'TEXT', 'Feirão de Carros',
      $t$Oi, {{1}}! Tudo bem? 😊

Vem aí o nosso *Feirão de Carros*: {{2}}, aqui na loja, com condições que não aparecem todo dia — {{3}}.

Vai ser por ordem de chegada e os melhores carros saem primeiro. Quer que eu já separe um atendimento pra você? É só responder essa mensagem. 🚗$t$,
      $v$[{"name":"primeiro_nome","example":"João"},{"name":"data_evento","example":"sábado, dia 25/07, a partir das 9h"},{"name":"condicoes","example":"entrada facilitada, taxa reduzida e avaliação do seu usado na hora"}]$v$,
      'Pra não receber mais ofertas, responda SAIR.',
      '[{"type":"QUICK_REPLY","text":"Quero saber mais"}]'
    )
  ) as t(nome, titulo, categoria, header_type, header_content, corpo, variaveis, rodape, botoes)
  on conflict (user_id, meta_template_name) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$fn$;

comment on function public.seed_default_templates(uuid) is
  'Cria os templates padrão (status draft) para um tenant. Idempotente. Chamada pelo trigger de signup e usada no backfill.';

-- ─── 3. Toda conta NOVA nasce com os templates ──────────────────────────────
-- Estende o handle_new_user (001) sem perder a criação do profile.
-- O seed é isolado num bloco com EXCEPTION: falhar aqui NUNCA pode quebrar o
-- cadastro de um usuário.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;

  begin
    perform public.seed_default_templates(new.id);
  exception when others then
    raise warning '[handle_new_user] seed_default_templates falhou para %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

-- ─── 4. Backfill: contas que já existem ─────────────────────────────────────

do $$
declare
  u record;
  total integer := 0;
  n integer;
begin
  for u in select id from auth.users loop
    n := public.seed_default_templates(u.id);
    total := total + n;
  end loop;
  raise notice 'Backfill concluído: % template(s) criado(s)', total;
end $$;
