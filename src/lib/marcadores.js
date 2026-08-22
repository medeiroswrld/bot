// Detecção de campos num contrato preenchido, para virar modelo.
//
// A loja cola o contrato de uma venda real e o sistema propõe onde entram os
// marcadores. NÃO aplica sozinho: cada proposta é confirmada.
//
// O motivo de exigir confirmação não é excesso de zelo. Formato rígido (CPF,
// CNPJ, placa, chassi) o regex acerta; mas nome e endereço são indistinguíveis
// entre si — olhando "Marcelo Costa Dos Santos" não há como saber se é o
// comprador, o vendedor ou a testemunha. Chutar ali produziria um contrato
// assinado com o nome no lugar errado.

/** Rótulos que a maioria dos contratos de loja usa em "CLÁUSULA – DO OBJETO".
 *  Este é o sinal mais confiável que existe: o próprio contrato diz o que é. */
const POR_ROTULO = [
  [/^\s*marca\s*:/i,                        'marca'],
  [/^\s*modelo\s*:/i,                       'modelo'],
  [/^\s*vers[ãa]o\s*:/i,                    'versao'],
  [/^\s*placa\s*:/i,                        'placa'],
  [/^\s*renavam\s*:/i,                      'renavam'],
  [/^\s*chassi(s)?\s*:/i,                   'chassi'],
  [/^\s*(km|quilometragem)\s*:/i,           'km'],
  [/^\s*cor\s*:/i,                          'cor'],
  [/^\s*combust[íi]vel\s*:/i,               'combustivel'],
  [/^\s*vendedor(a)?\s*:/i,                 'vendedor'],
  [/^\s*data\s+da\s+venda\s*:/i,            'data'],
  [/^\s*ano(\s+de)?(\s+fabrica[çc][ãa]o)?(\s*\/\s*modelo)?\s*:/i, 'ano'],
  [/^\s*e-?mail\s*:/i,                      'comprador_email'],
  [/^\s*telefone\s*\d*\s*(\([^)]*\))?\s*:/i, 'comprador_telefone'],
];

/** Formatos que se reconhecem sozinhos, onde quer que apareçam. */
const POR_FORMATO = [
  { re: /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, campo: 'loja_cnpj',      o: ['loja_cnpj', 'comprador_cpf'] },
  { re: /\d{3}\.\d{3}\.\d{3}-\d{2}/g,        campo: 'comprador_cpf',  o: ['comprador_cpf', 'loja_cnpj'] },
  { re: /\b[A-Z]{3}-?\d{4}\b|\b[A-Z]{3}\d[A-Z]\d{2}\b/g, campo: 'placa', o: ['placa', 'troca_placa'] },
  { re: /\b[A-HJ-NPR-Z0-9]{17}\b/g,          campo: 'chassi',         o: ['chassi', 'troca_chassi'] },
  { re: /R\$\s?[\d.]{1,12},\d{2}/g,          campo: 'valor',          o: ['valor', 'troca_valor'] },
  { re: /\b\d{2}\/\d{2}\/\d{4}\b/g,          campo: 'data',           o: ['data'] },
];

/** Todo campo pode ser trocado por outro na revisão — a lista completa vive em
 *  contrato.js e é injetada pela tela, para não duplicar a fonte da verdade. */
const ALTERNATIVAS_ROTULO = {
  marca:   ['marca', 'troca_marca'],
  modelo:  ['modelo', 'troca_modelo'],
  placa:   ['placa', 'troca_placa'],
  renavam: ['renavam', 'troca_renavam'],
  chassi:  ['chassi', 'troca_chassi'],
  km:      ['km', 'troca_km'],
  ano:     ['ano', 'ano_modelo', 'troca_ano'],
  cor:     ['cor', 'troca_cor'],
};

/**
 * Procura campos no texto e devolve um achado por VALOR distinto, não por
 * ocorrência.
 *
 * Agrupar por valor é o que faz a coisa funcionar num contrato de verdade: o
 * nome e o CPF do comprador aparecem na qualificação E na assinatura. Tratados
 * como achados separados, o lojista confirmaria o mesmo dado duas vezes e ainda
 * poderia marcar diferente em cada lugar.
 */
export function detectar(texto) {
  const bruto = String(texto ?? '');
  if (!bruto.trim()) return [];

  const achados = new Map(); // valor → { valor, campo, alternativas, ocorrencias, contexto }

  const registrar = (valor, campo, alternativas, contexto) => {
    const v = String(valor).trim();
    // Valor curto demais vira ruído: "SP", "0" e afins aparecem em cláusula e
    // marcá-los estragaria o texto fixo.
    if (v.length < 3) return;
    const ja = achados.get(v);
    if (ja) { ja.ocorrencias += 1; return; }
    achados.set(v, {
      valor: v,
      campo,
      alternativas: alternativas ?? [campo],
      ocorrencias: 1,
      contexto: contexto ?? '',
    });
  };

  // 1) Linhas com rótulo — o contrato dizendo o que cada coisa é.
  for (const linha of bruto.split('\n')) {
    for (const [re, campo] of POR_ROTULO) {
      if (!re.test(linha)) continue;

      const bruta = linha.slice(linha.indexOf(':') + 1);

      // Corta no PRÓXIMO rótulo da mesma linha. Contrato de loja escreve
      // "Modelo: CIVIC LXL Ano Fabricação/Modelo: 2010/2010" numa linha só, e
      // sem cortar aqui o modelo engoliria o ano junto.
      // Só corta em rótulo CONHECIDO. Cortar em "qualquer palavra seguida de
      // dois-pontos" parece mais geral, mas parte o valor no meio quando o
      // modelo tem várias palavras — "CIVIC LXL FLEX FLEX" virava "CIVIC LXL
      // FLEX".
      const corte = bruta.search(
        /\s+(ano|modelo|marca|vers[ãa]o|placa|renavam|chassis?|km|quilometragem|cor|combust[íi]vel|vendedor|data)[a-zà-ÿ\s/]*:/i,
      );
      const valor = (corte > 0 ? bruta.slice(0, corte) : bruta).trim();

      // Valor de campo é curto. Parágrafo inteiro significa que o "rótulo" era
      // na verdade a abertura de uma cláusula — "VENDEDORA: Fulano Ltda, pessoa
      // jurídica de direito privado, com CNPJ..." casa com /vendedora?:/ e
      // levaria a qualificação inteira embora.
      if (valor && valor.length <= 60) {
        registrar(valor, campo, ALTERNATIVAS_ROTULO[campo], linha.trim());
      }
      break; // um rótulo por linha
    }
  }

  // 2) Formatos reconhecíveis em qualquer lugar do texto.
  for (const { re, campo, o } of POR_FORMATO) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(bruto)) !== null) {
      const ini = Math.max(0, m.index - 45);
      const contexto = `…${bruto.slice(ini, m.index + m[0].length + 45).replace(/\s+/g, ' ').trim()}…`;
      registrar(m[0], campo, o, contexto);
    }
  }

  // Mais longo primeiro: se um valor contém outro (o CPF dentro de uma linha
  // inteira capturada por rótulo), substituir o maior antes evita que o menor
  // parta o marcador já inserido.
  return [...achados.values()].sort((a, b) => b.valor.length - a.valor.length);
}

/**
 * Aplica as escolhas confirmadas. `escolhas` é { valor: campo | null } — null
 * significa "deixa como está".
 */
export function aplicar(texto, escolhas) {
  let saida = String(texto ?? '');

  const valores = Object.keys(escolhas ?? {})
    .filter((v) => escolhas[v])
    .sort((a, b) => b.length - a.length);

  for (const valor of valores) {
    // split/join em vez de regex: valor de contrato tem ponto, barra e
    // parêntese, e escapar tudo isso é mais frágil que não usar regex.
    saida = saida.split(valor).join(`{{${escolhas[valor]}}}`);
  }
  return saida;
}
