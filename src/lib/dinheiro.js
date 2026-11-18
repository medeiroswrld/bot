// Preço e número na moeda e no formato do país da loja.
//
// Gêmeo de `supabase/functions/_shared/dinheiro.ts`. Os dois existem porque o
// front e as edge functions não compartilham módulo — mas a regra de formatação
// tem que ser a MESMA, senão o lojista vê um valor na tela e o cliente recebe
// outro pelo WhatsApp.
//
// ── Por que `Intl` e não concatenar o símbolo ─────────────────────────────
//
// A posição do símbolo é parte do idioma:
//
//     pt-BR  BRL    R$ 27.900      símbolo antes, ponto no milhar
//     pt-PT  EUR    27 900 €       símbolo DEPOIS, espaço no milhar
//     es-ES  EUR    27.900 €       símbolo depois, ponto no milhar
//     en     EUR    €27,900        símbolo antes, sem espaço, vírgula
//
// ── Por que o Brasil não muda ────────────────────────────────────────────
//
// Defaults BRL/pt-BR, e a saída é byte a byte igual ao que os 8 helpers
// espalhados pelas views produziam. `minimumFractionDigits: 0` é o que garante
// isso: sem ele o `Intl` escreve "R$ 27.900,00".

/**
 * O `Intl` separa símbolo e número com espaço NÃO-SEPARÁVEL (U+00A0), e em
 * alguns locales usa U+202F no milhar. Invisíveis na tela, bytes diferentes do
 * espaço comum — era o que fazia a saída deixar de ser idêntica à de antes.
 */
function espacoComum(s) {
  return String(s).replace(/[\u00A0\u202F]/g, ' ');
}

/**
 * Preço formatado na moeda da loja.
 *
 * `min` e `max` são explicitos porque os 8 helpers que isto substitui NÃO
 * concordavam entre si, e a diferença é visível:
 *
 *     preço de carro        min 0, max 2   "R$ 27.900"      (sem centavos à toa)
 *     resumo do dashboard   min 0, max 0   "R$ 27.900"      (arredonda)
 *     custo e faturamento   min 2, max 2   "R$ 27.900,00"   (centavo importa)
 *
 * O default é o do preço de carro, que é o caso mais comum. Quem precisa de
 * centavo pede: foi assim que eu quase apaguei os centavos de `financeiro.js`.
 */
export function dinheiro(valor, moeda = 'BRL', locale = 'pt-BR', { min = 0, max = 2 } = {}) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  try {
    return espacoComum(new Intl.NumberFormat(String(locale || 'pt-BR'), {
      style: 'currency',
      currency: String(moeda || 'BRL').toUpperCase(),
      minimumFractionDigits: min,
      maximumFractionDigits: Math.max(min, max),
    }).format(n));
  } catch {
    // Moeda inválida no banco derrubaria o `Intl`. Melhor o valor sair sem
    // símbolo do que a tela quebrar.
    return espacoComum(n.toLocaleString('pt-BR'));
  }
}

/** Número puro (km, quantidade) no formato do país. */
export function numero(valor, locale = 'pt-BR') {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  try {
    return espacoComum(n.toLocaleString(String(locale || 'pt-BR')));
  } catch {
    return espacoComum(n.toLocaleString('pt-BR'));
  }
}

/**
 * Só o símbolo — para rótulo de formulário ("Valor (R$)" → "Valor (€)").
 *
 * Tirado do próprio `Intl` em vez de um mapa escrito à mão, senão cada moeda
 * nova exigiria editar este arquivo.
 */
export function simboloDe(moeda = 'BRL', locale = 'pt-BR') {
  try {
    const partes = new Intl.NumberFormat(String(locale || 'pt-BR'), {
      style: 'currency', currency: String(moeda || 'BRL').toUpperCase(),
    }).formatToParts(0);
    return partes.find((p) => p.type === 'currency')?.value ?? 'R$';
  } catch {
    return 'R$';
  }
}
