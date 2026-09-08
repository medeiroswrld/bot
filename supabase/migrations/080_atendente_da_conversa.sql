-- 080 — quem da equipe está atendendo cada conversa
--
-- A loja replica o mesmo WhatsApp em três celulares. Toda resposta chega pelo
-- mesmo número, então o CRM mostra "humano" sem dizer QUAL humano — e o dono
-- não sabe quem está com qual cliente.
--
-- Marcar à mão não resolveria: quem responde está no celular, não no CRM.
-- Então o webhook lê a auto-identificação que a equipe já escreve por hábito
-- ("me chamo rodrigo") e carimba a conversa sozinho. O clique manual fica só
-- para o que sobrar.
--
-- `atendente` guarda o NOME, não um id de usuário, de propósito: a loja tem um
-- login só e os vendedores não são contas do sistema. No dia em que virarem,
-- a coluna continua servindo como rótulo e ganha um id ao lado.

alter table public.conversations
  add column if not exists atendente      text,
  add column if not exists atendente_em   timestamptz,
  add column if not exists atendente_auto boolean not null default false;

comment on column public.conversations.atendente is
  'Nome do vendedor que está atendendo. Vem da lista em company_settings.team_members.';
comment on column public.conversations.atendente_auto is
  'true = detectado pela assinatura na mensagem; false = escolhido à mão no CRM. O manual nunca é sobrescrito pelo automático.';

-- A pergunta operacional é "quem está com o quê AGORA", então o índice cobre
-- as conversas vivas de cada loja.
create index if not exists conversations_atendente_idx
  on public.conversations (user_id, atendente)
  where atendente is not null;
