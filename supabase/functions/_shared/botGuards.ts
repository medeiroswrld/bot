// Travas que decidem se o bot responde. Compartilhadas de propósito.
//
// Estas regras viviam só dentro do whatsapp-webhook. O social-webhook nasceu
// depois e não recebeu nenhuma delas — resultado: loja suspensa continuava
// sendo atendida pelo Instagram, bot desligado respondia mesmo assim, e a
// janela de horário não valia fora do WhatsApp.
//
// Ninguém percebeu porque as duas cópias nunca foram comparadas. Módulo único
// é o que impede a próxima divergência.

export interface GuardasDoBot {
  bot_enabled?: boolean | null;
  bot_schedule_enabled?: boolean | null;
  bot_start?: string | null;
  bot_end?: string | null;
  suspenso?: boolean | null;
  bot_contratado?: boolean | null;
  assinatura_status?: string | null;
  trial_termina_em?: string | null;
  ultimo_pagamento_em?: string | null;
  assinatura_motivo?: string | null;
}

/**
 * A assinatura esta em dia?
 *
 * Passam dois casos, e so dois:
 *
 *   'ativa'  — pagou pelo cartao, confirmado pelo webhook do Asaas
 *   'isento' — cobrado por fora. E o caso da DSC e da Leandrinho, que pagam
 *              por transferencia e nunca terao assinatura no Asaas. Sem este
 *              estado, ligar a cobranca cortaria justamente os clientes que
 *              pagam.
 *
 * Coluna ausente tambem passa. Isso nao e descuido: e o que mantem o sistema
 * de pe se esta funcao rodar antes da migration chegar ao banco, ou se alguem
 * esquecer `assinatura_status` no select. Neste projeto ja derrubamos producao
 * duas vezes por ordem de migration — a falha aqui tem que ser para o lado de
 * ATENDER o cliente, nunca para o lado de calar o bot de todo mundo.
 */
export function assinaturaEmDia(
  status?: string | null,
  trialFim?: string | null,
  ultimoPagamento?: string | null,
  motivo?: string | null,
): boolean {
  if (status === null || status === undefined || status === '') return true;
  if (status === 'ativa' || status === 'isento') return true;

  // Quem CANCELOU fica ate o fim do mes que ja pagou.
  //
  // Cortar no instante do clique seria cobrar por um mes e entregar os dias
  // ate o arrependimento. Volta como reclamacao ou chargeback, que custa mais
  // que o mes — e e o tipo de coisa que o lojista conta para os outros.
  //
  // O motivo importa porque `cancelada` nao quer dizer uma coisa so: o webhook
  // chega nesse estado por cinco caminhos, e so UM e o cliente saindo pela
  // porta. Estorno e chargeback sao o dinheiro voltando — dar um mes de bot de
  // graca a quem acabou de pedir reembolso seria pagar para ser estornado.
  if (status === 'cancelada') {
    if (motivo !== 'cancelamento') return false;
    if (!ultimoPagamento) return false;
    const fim = new Date(ultimoPagamento);
    if (!Number.isFinite(fim.getTime())) return false;
    fim.setMonth(fim.getMonth() + 1);
    return fim.getTime() > Date.now();
  }

  // 'trial' passa, mas SO ate a data. Teste em que o bot nao responde nao e
  // teste — a loja sai dele achando que o produto nao funciona.
  //
  // A data e conferida AQUI, e nao deixada so para o cron de expiracao, porque
  // o cron roda uma vez por dia as 6h: quem comeca o teste as 13h de quarta
  // ganharia 17 horas de brinde. Com a comparacao na trava, o corte e no
  // minuto. O cron continua existindo para virar o `assinatura_status` — e ele
  // que faz o CRM pedir o plano e a tela mostrar o motivo.
  if (status === 'trial') {
    // Sem a data, passa. Mesmo motivo de a coluna ausente passar: se esta
    // funcao rodar antes da migration chegar, a falha tem que ser para o lado
    // de ATENDER o cliente, nunca para o lado de calar o bot de todo mundo.
    if (!trialFim) return true;
    const fim = new Date(trialFim).getTime();
    if (!Number.isFinite(fim)) return true;
    return fim > Date.now();
  }

  return false;
}

/** Colunas que qualquer webhook precisa ler para decidir. */
export const COLUNAS_GUARDA =
  'bot_enabled, bot_schedule_enabled, bot_start, bot_end, suspenso, bot_contratado, bot_blocked_numbers, assinatura_status, trial_termina_em, ultimo_pagamento_em, assinatura_motivo';

/** Colunas necessárias para checar disparo em massa. */
export const COLUNAS_DISPARO = 'suspenso, disparos_contratado, assinatura_status, trial_termina_em, ultimo_pagamento_em, assinatura_motivo';

/**
 * A loja pode ENVIAR em massa (campanha, aniversário, template)?
 *
 * Separado do bot de propósito: existe cliente que quer disparo e não quer bot,
 * e o contrário também. Dois booleanos independentes combinam sozinhos; um
 * campo `plano` com três valores obrigaria a reescrever toda checagem no dia
 * em que aparecer a quarta combinação.
 *
 * Suspensão continua cortando tudo — inadimplente não dispara.
 */
export function podeDisparar(
  s: {
    suspenso?: boolean | null;
    disparos_contratado?: boolean | null;
    assinatura_status?: string | null;
    trial_termina_em?: string | null;
    ultimo_pagamento_em?: string | null;
    assinatura_motivo?: string | null;
  } | null | undefined,
): boolean {
  if (s?.suspenso === true) return false;
  if (!assinaturaEmDia(s?.assinatura_status, s?.trial_termina_em, s?.ultimo_pagamento_em, s?.assinatura_motivo)) return false;
  return s?.disparos_contratado !== false;
}

/**
 * O bot deve responder agora?
 *
 * Roda no WEBHOOK e não no prompt: fora do horário nem existe chamada de
 * modelo, então não há custo nem risco de o modelo "decidir" responder assim
 * mesmo.
 */
export function botPodeResponder(s: GuardasDoBot | null | undefined): boolean {
  // Plano sem bot vem primeiro: existe cliente que compra só o CRM. A coluna é
  // protegida por trigger no banco (070) — esconder o botão na tela não impede
  // ninguém de chamar a API.
  if (s?.bot_contratado === false) return false;

  // Suspensão do administrador não tem exceção. É separada de bot_enabled de
  // propósito: aquela é do lojista, esta é do dono do sistema — senão o
  // inadimplente se reativaria sozinho.
  if (s?.suspenso === true) return false;

  // Assinatura vencida cala o bot, pelo mesmo motivo da suspensão: é decisão do
  // dono do sistema, não do lojista. A diferença é que aqui quem decide não é
  // uma pessoa clicando um botão, e sim o pagamento entrar ou não.
  if (!assinaturaEmDia(s?.assinatura_status, s?.trial_termina_em, s?.ultimo_pagamento_em, s?.assinatura_motivo)) return false;

  if (s?.bot_enabled === false) return false;
  if (s?.bot_schedule_enabled !== true) return true;

  const agora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());

  // O Postgres devolve time como "18:00:00"; comparamos só HH:MM.
  const ini = String(s.bot_start ?? '00:00').slice(0, 5);
  const fim = String(s.bot_end   ?? '23:59').slice(0, 5);
  if (ini === fim) return true;              // janela degenerada: não cala o bot

  // Janela que ATRAVESSA A MEIA-NOITE (ex: 18:00 às 08:00) é o caso comum aqui
  // — loja com equipe de dia querendo o bot só à noite. Tratar como intervalo
  // simples deixaria o bot mudo 24h.
  return ini < fim ? (agora >= ini && agora < fim) : (agora >= ini || agora < fim);
}

/**
 * Este contato está na lista de bloqueio da loja?
 *
 * Compara por DDD + 8 dígitos finais, não por texto. O mesmo telefone chega da
 * Meta como "5515988372081" e é digitado no cadastro como "(15) 98837-2081" —
 * e o nono dígito entrou em épocas diferentes por região. Comparar string crua
 * faria a lista falhar justamente para quem a cadastrou com carinho.
 *
 * Em canal social o identificador é um PSID/IGSID, não um telefone: não casa
 * com nada aqui, e é o comportamento certo — bloquear por telefone não faz
 * sentido para quem chegou pelo Instagram.
 */
export function numeroBloqueado(lista: unknown, telefone: string): boolean {
  if (!Array.isArray(lista) || !lista.length) return false;

  const chave = (v: unknown) => {
    let d = String(v ?? '').replace(/\D/g, '');
    if (d.length > 11) d = d.slice(-11);                  // fora o 55
    if (d.length === 11) d = d.slice(0, 2) + d.slice(3);  // fora o nono dígito
    return d;
  };

  const alvo = chave(telefone);
  if (alvo.length < 10) return false;
  return lista.some((n) => chave(typeof n === 'string' ? n : (n as { numero?: string })?.numero) === alvo);
}
