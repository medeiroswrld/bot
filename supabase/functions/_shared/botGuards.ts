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
}

/** Colunas que qualquer webhook precisa ler para decidir. */
export const COLUNAS_GUARDA =
  'bot_enabled, bot_schedule_enabled, bot_start, bot_end, suspenso, bot_contratado, bot_blocked_numbers';

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
