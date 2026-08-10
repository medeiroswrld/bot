// Normalização de telefone brasileiro para importação de contatos e disparo.
//
// A planilha do lojista chega com tudo: "(11) 99999-9999", "11999999999",
// "+55 11 9999-9999", "5511999999999". Todos são o mesmo cliente, e se a gente
// gravar cru o mesmo contato entra várias vezes e o disparo falha.

// DDDs que existem de verdade. Sem essa lista, "00" e "10" passariam e virariam
// número inválido no meio de um disparo pago.
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Normaliza um telefone brasileiro.
 *
 * Devolve `e164` (o que vai pro banco e pro WhatsApp) e `chave` (forma canônica
 * só pra comparar duplicados). A `chave` ignora o nono dígito de propósito:
 * a Meta devolve celular antigo como 5511XXXXXXXX enquanto a planilha do
 * cliente tem 55119XXXXXXXX — é a mesma pessoa, e sem isso ela duplicaria.
 */
export function normalizarTelefone(bruto) {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (!d) return { ok: false, motivo: 'vazio' };

  // 00 55 ... / 0 11 ... — prefixos de discagem que as pessoas colam junto
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  else if (d.startsWith('0')) d = d.replace(/^0+/, '');

  if (d.length < 10) return { ok: false, motivo: 'faltam dígitos (sem DDD?)' };
  if (d.length > 11) return { ok: false, motivo: 'dígitos demais' };

  const ddd = Number(d.slice(0, 2));
  if (!DDDS.has(ddd)) return { ok: false, motivo: `DDD ${d.slice(0, 2)} não existe` };

  let numero = d.slice(2);
  const primeiro = Number(numero[0]);

  // Celular antigo de 8 dígitos: o 9 foi acrescentado na frente pela Anatel.
  // Só vale pra móvel (começa em 6-9); fixo começa em 2-5 e não leva 9.
  let tipo = 'fixo';
  if (numero.length === 9) {
    tipo = 'movel';
  } else if (primeiro >= 6) {
    numero = `9${numero}`;
    tipo = 'movel';
  }

  return {
    ok: true,
    tipo,
    e164: `55${ddd}${numero}`,
    // últimos 8 dígitos + DDD: estável com ou sem o nono dígito
    chave: `55${ddd}${numero.slice(-8)}`,
  };
}

/** Formata pra leitura humana na tela de conferência: 55 11 99999-9999 */
export function formatarTelefone(e164) {
  const d = String(e164 ?? '').replace(/\D/g, '');
  if (d.length < 12) return e164 ?? '';
  const ddd = d.slice(2, 4);
  const n = d.slice(4);
  return n.length === 9
    ? `(${ddd}) ${n.slice(0, 5)}-${n.slice(5)}`
    : `(${ddd}) ${n.slice(0, 4)}-${n.slice(4)}`;
}

// Um trecho que parece telefone: começa em dígito (ou parêntese), tem só
// dígito/espaço/pontuação de telefone, e no mínimo 8 caracteres.
const CORRIDA_TELEFONE = String.raw`\+?\s*\(?\d[\d\s().+-]{6,}\d`;
const TEL_NO_FIM     = new RegExp(`(${CORRIDA_TELEFONE})\\s*$`);
const TEL_NO_COMECO  = new RegExp(`^(${CORRIDA_TELEFONE})`);

/**
 * Lê o texto colado. Cada linha vira um contato.
 *
 * Em vez de procurar separador, ACHA O TELEFONE dentro da linha e trata o resto
 * como nome. A primeira versão só quebrava em TAB/;/, e perdia o nome quando a
 * lista vinha separada por espaços — que é o que sai ao copiar de PDF, de tabela
 * formatada ou de mensagem de WhatsApp. Pior: parecia funcionar, porque nome não
 * tem dígito e o telefone saía certo mesmo assim.
 *
 * Também cobre linha sem espaço nenhum ("Jaqueline Teles(15) 99665-0535") e
 * coluna invertida (telefone antes do nome).
 */
export function parsearContatos(texto) {
  return String(texto ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((linha) => {
      const limpo = linha.replace(/[\t;|]+/g, ' ');
      const m = limpo.match(TEL_NO_FIM) ?? limpo.match(TEL_NO_COMECO);

      if (!m) return { nome: limpo.replace(/\s+/g, ' ').trim(), telefone: '', linha };

      const telefone = m[1].trim();
      const nome = limpo
        .replace(m[1], ' ')
        .replace(/^[\s,;-]+|[\s,;-]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      return { nome, telefone, linha };
    });
}
