// O estoque em texto, pra colar ou enviar.
//
// Existe para o lojista que NÃO tem bot — ele abre o estoque, copia e cola na
// conversa dele, no grupo, no Instagram. Custo zero: não passa por template, por
// API da Meta, nem pelo atendimento automático.
//
// ── Uma linha por carro, e só ───────────────────────────────────────────────
//
// A tentação é mandar tudo: versão, câmbio, combustível, opcionais. Vinte e
// cinco carros assim viram uma parede de texto que ninguém lê — o mesmo defeito
// que acabamos de corrigir no bot. O que decide se a pessoa responde é modelo,
// ano, km e preço. O resto ela pergunta.
//
// Sem foto de propósito: foto é o que pesa, e quem copia texto quer colar em
// qualquer lugar.

const dinheiro = (v) =>
  v == null || v === '' ? 'consulte' : `R$ ${Number(v).toLocaleString('pt-BR')}`;

const km = (v) =>
  v == null || v === '' ? null : `${Number(v).toLocaleString('pt-BR')} km`;

/**
 * Monta o texto a partir de uma lista de veículos já filtrada pela tela.
 *
 * Respeitar o filtro é o ponto: "as picapes até 80 mil" é uma mensagem que se
 * lê; o estoque inteiro é um documento que se ignora.
 */
export function estoqueEmTexto(carros, { nomeDaLoja } = {}) {
  const lista = (carros ?? []).filter((c) => c && c.status !== 'sold');
  if (!lista.length) return '';

  // Mais barato primeiro: quem pede lista costuma estar procurando preço, e a
  // primeira linha é a que segura a leitura.
  const ordenados = [...lista].sort(
    (a, b) => (Number(a.price) || Infinity) - (Number(b.price) || Infinity),
  );

  const linhas = ordenados.map((c) => {
    const nome = [c.brand, c.model, c.version].filter(Boolean).join(' ').trim();
    const ano = c.year ? String(c.year) : null;
    const detalhe = [ano, km(c.mileage)].filter(Boolean).join(' · ');
    return detalhe
      ? `• ${nome} — ${detalhe} — ${dinheiro(c.price)}`
      : `• ${nome} — ${dinheiro(c.price)}`;
  });

  const cabecalho = nomeDaLoja ? `${nomeDaLoja} — veículos disponíveis` : 'Veículos disponíveis';
  const rodape = lista.length > 1
    ? `\nSão ${lista.length} veículos. Me diga qual te interessou que eu mando fotos e detalhes.`
    : '\nMe diga se te interessou que eu mando fotos e detalhes.';

  return `${cabecalho}\n\n${linhas.join('\n')}\n${rodape}`;
}

/** Copia para a área de transferência. Devolve true quando deu certo. */
export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Navegador sem permissão, ou página fora de HTTPS. O caminho antigo ainda
    // funciona nesses casos e é melhor que dizer "não consegui copiar".
    try {
      const area = document.createElement('textarea');
      area.value = texto;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}
