// Decide se a conta de uma loja está bloqueada por falta de pagamento.
//
// Vive sozinho num arquivo porque a regra é dinheiro: tem que dar pra ler
// inteira, de uma vez, sem caçar pedaço espalhado por tela.

/**
 * Dias de tolerância depois do vencimento antes de trancar o sistema.
 *
 * Não é o mesmo que "o bot para": o bot e os disparos já param assim que a
 * assinatura sai de dia (ver `assinaturaEmDia` no botGuards das edge
 * functions). Este número é mais longo de propósito — tirar o atendimento
 * automático é um aperto, trancar o CRM inteiro é a última medida.
 */
export const DIAS_ATE_BLOQUEAR = 20;

/**
 * Estado de bloqueio da conta.
 *
 * Devolve `{ bloqueada, motivo, diasVencido }`, onde `motivo` é:
 *   'suspensa' → um humano bloqueou pelo /admin
 *   'fatura'   → vencimento passou de DIAS_ATE_BLOQUEAR
 *   null       → tudo certo
 */
export function estadoDaConta(cfg) {
  const livre = { bloqueada: false, motivo: null, diasVencido: null };
  if (!cfg) return livre;

  // ── ISENTO NUNCA BLOQUEIA ─────────────────────────────────────────────────
  //
  // Vem PRIMEIRO, antes de qualquer outra checagem, e é proposital: parceiro
  // não pode ficar sem sistema por causa de regra de cobrança. Se um dia
  // alguém acrescentar uma condição nova aqui embaixo, ela já nasce sem poder
  // sobre quem é isento — a proteção não depende de lembrarem dela.
  if (cfg.assinatura_status === 'isento') return livre;

  // Suspensão manual do administrador. Decisão de gente, não de regra.
  if (cfg.suspenso === true) {
    return { bloqueada: true, motivo: 'suspensa', diasVencido: null };
  }

  // ── Vencimento ────────────────────────────────────────────────────────────
  //
  // Sem data de vencimento não há como contar dias — e, nesse caso, NÃO
  // bloqueia. A falha é sempre para o lado de deixar a loja trabalhar: uma
  // conta liberada por engano custa uma conversa; uma conta trancada por
  // engano custa o cliente.
  const venc = cfg.proximo_vencimento;
  if (!venc) return livre;

  // Comparação em dia cheio, no fuso local. `proximo_vencimento` é DATE no
  // banco ("2026-11-20"), então `new Date(...)` sem hora viraria UTC e poderia
  // adiantar ou atrasar um dia dependendo do fuso de quem olha a tela.
  const [ano, mes, dia] = String(venc).slice(0, 10).split('-').map(Number);
  if (!ano || !mes || !dia) return livre;

  const vencimento = new Date(ano, mes - 1, dia);
  const hoje = new Date();
  const hojeSemHora = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const diasVencido = Math.floor((hojeSemHora - vencimento) / 86400000);

  if (diasVencido <= DIAS_ATE_BLOQUEAR) return { ...livre, diasVencido };

  // Passou da tolerância. Só bloqueia se o status confirmar a dívida — assim
  // um vencimento velho que já foi pago (e o status voltou pra 'ativa') não
  // tranca ninguém.
  const devendo = ['atrasada', 'cancelada', 'sem_assinatura'].includes(cfg.assinatura_status);
  if (!devendo) return { ...livre, diasVencido };

  return { bloqueada: true, motivo: 'fatura', diasVencido };
}

/**
 * A rota continua acessível com a conta bloqueada?
 *
 * Só Conversas. O lojista perde o PRODUTO (estoque, disparo, agenda,
 * configuração) e mantém o DADO — as mensagens de quem está escrevendo pra ele
 * agora. Trancar isso também faria o sistema contradizer o que ele mesmo
 * promete no aviso: "as mensagens continuam chegando e ficam em Conversas —
 * nada se perde".
 */
export function rotaLiberadaNoBloqueio(pathname) {
  return String(pathname || '').startsWith('/conversas');
}
