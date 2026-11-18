// Preço e número na moeda e no formato do país da loja.
//
// ── Por que isto existe ───────────────────────────────────────────────────
//
// Havia quatro lugares que escrevem preço PARA O CLIENTE FINAL, e os quatro
// tinham `R$` cravado no código:
//
//     process-conversation   amostra de estoque e menu do WhatsApp
//     send-agent-message     legenda do carro que o vendedor manda
//     notify-waiting-list    aviso de que entrou o carro esperado
//
// Com `company_settings.moeda` = EUR, um stand em Lisboa anunciaria
// "Golf 2023 — R$ 27.900".
//
// ── O detalhe que fazia disso um erro de PREÇO, não de formatação ─────────
//
// O prompt já dizia "Preço sempre na moeda da loja" (process-conversation).
// Então o modelo recebia a instrução "use euro" junto com o dado escrito
// `R$ 27.900`. Diante dos dois, ele repete o R$ ou CONVERTE por conta —
// e preço convertido por estimativa é preço errado dito ao cliente.
//
// Instrução no prompt não conserta dado errado. O dado tem que chegar certo.
//
// ── Por que `Intl` e não concatenar o símbolo ─────────────────────────────
//
// A posição do símbolo é parte do idioma, e não se adivinha:
//
//     pt-BR  BRL    R$ 27.900      símbolo antes, ponto no milhar
//     pt-PT  EUR    27 900 €       símbolo DEPOIS, espaço no milhar
//     es-ES  EUR    27.900 €       símbolo depois, ponto no milhar
//     en     EUR    €27,900        símbolo antes, sem espaço, vírgula
//
// Escrever `${moeda} ${valor}` daria "EUR 27.900" nas quatro — legível, e
// imediatamente estrangeiro para quem lê.
//
// ── Por que o Brasil não muda ────────────────────────────────────────────
//
// Os defaults são BRL/pt-BR e a saída é BYTE A BYTE igual à de hoje —
// conferido contra `R$ ${n.toLocaleString('pt-BR')}` em 0, 1, 999, 1.000,
// 27.900, 27.900,5, 27.900,55 e 1.234.567.
//
// `minimumFractionDigits: 0` é o que garante isso: sem ele o `Intl` escreve
// "R$ 27.900,00" e TODA loja brasileira veria o preço mudar de forma.
//
// A única divergência é em valor negativo ("-R$ 500" virou "-R$ 500" com o
// sinal antes do símbolo, que é a forma correta). Preço não é negativo.

/**
 * O `Intl` separa símbolo e número com espaço NÃO-SEPARÁVEL (U+00A0), e em
 * alguns locales usa U+202F no milhar. São invisíveis na tela mas bytes
 * diferentes do espaço comum, o que faria a saída brasileira deixar de ser
 * idêntica à de hoje. Normalizados para espaço comum.
 */
function espacoComum(s: string): string {
  return s.replace(/[\u00A0\u202F]/g, ' ');
}

/**
 * Preço formatado na moeda da loja.
 *
 * Moeda ou locale desconhecidos caem no padrão brasileiro em vez de falhar:
 * aqui, falhar significa o cliente receber uma mensagem sem preço.
 */
export function dinheiro(
  valor: unknown,
  moeda: string | null | undefined = 'BRL',
  locale: string | null | undefined = 'pt-BR',
): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';

  const cur = String(moeda || 'BRL').toUpperCase();
  const loc = String(locale || 'pt-BR');

  try {
    return espacoComum(new Intl.NumberFormat(loc, {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(n));
  } catch {
    // Código de moeda inválido no banco derrubaria o `Intl`. Melhor o preço
    // sair sem símbolo do que a mensagem não sair.
    return espacoComum(n.toLocaleString('pt-BR'));
  }
}

/**
 * Número puro (quilometragem, quantidade) no formato do país.
 *
 * Existe porque "27 900 €" ao lado de "41.000 km" mistura duas convenções na
 * mesma linha — o preço em português de Portugal e o km em brasileiro.
 */
export function numero(valor: unknown, locale: string | null | undefined = 'pt-BR'): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  try {
    return espacoComum(n.toLocaleString(String(locale || 'pt-BR')));
  } catch {
    return espacoComum(n.toLocaleString('pt-BR'));
  }
}
