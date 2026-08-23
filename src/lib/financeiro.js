// Categorias e cálculos do financeiro.
//
// Categoria é TEXTO, não tabela. A lista abaixo é ponto de partida; o que a loja
// já usou entra como sugestão junto. Uma tabela de categorias exigiria tela de
// cadastro, permissão e manutenção para um dado que muda uma vez por ano — e o
// custo real disso é o lojista abandonar o módulo antes de lançar a primeira
// despesa.

/** Despesas que pertencem a UM veículo: entram no custo dele e no caixa do mês. */
export const CATEGORIAS_VEICULO = [
  'Compra de veículos',
  'Peças',
  'Manutenção veículos',
  'Preparação e estética',
  'Legalização',
  'Quitação de veículo',
  'Gastos gerais com veículos',
  'IPVA',
  'DPVAT',
];

/** Despesas da operação, sem dono. */
export const CATEGORIAS_OPERACAO = [
  'Aluguel',
  'Energia elétrica',
  'Água e esgoto',
  'Internet',
  'Contabilidade',
  'Sistema',
  'Impostos e taxas diversas',
  'Salários e comissões',
  'Marketing',
  'Despesas diversas',
];

export const CATEGORIAS_RECEITA = [
  'Venda de veículos',
  'Entradas',
  'Parcela de entrada',
  'Financiamentos',
  'Retornos dos bancos',
  'Negociação particular',
  'Consórcio',
  'Outras receitas',
];

/** Sugestões para o campo de categoria, sem repetir o que a loja já usou. */
export function sugestoes(tipo, comVeiculo, lancamentos = []) {
  const base = tipo === 'receita'
    ? CATEGORIAS_RECEITA
    : (comVeiculo ? CATEGORIAS_VEICULO : [...CATEGORIAS_OPERACAO, ...CATEGORIAS_VEICULO]);

  const usadas = [...new Set(
    lancamentos.filter((l) => l.tipo === tipo).map((l) => String(l.categoria || '').trim()),
  )].filter(Boolean);

  return [...new Set([...base, ...usadas])];
}

const num = (v) => Number(v) || 0;

/**
 * Fecha a conta de um veículo.
 *
 * `lucro` só existe depois de vendido. Antes disso o que existe é INVESTIDO —
 * chamar de prejuízo um carro que ainda está na loja assustaria o lojista sem
 * motivo, e é o tipo de número errado que faz alguém abandonar a tela.
 */
export function contaDoVeiculo(carro, lancamentos = []) {
  const doCarro = lancamentos.filter((l) => l.car_id === carro?.id);

  const gastos = doCarro
    .filter((l) => l.tipo === 'despesa')
    .reduce((s, l) => s + num(l.valor), 0);

  const receitasExtras = doCarro
    .filter((l) => l.tipo === 'receita' && l.ref !== `venda:${carro?.id}`)
    .reduce((s, l) => s + num(l.valor), 0);

  const compra = num(carro?.purchase_price);
  const venda = num(carro?.sold_price);
  const vendido = carro?.status === 'vendido' || carro?.status === 'sold';

  // A compra pode estar como lançamento automático E na coluna do carro. Conta
  // uma vez só: a coluna manda, e o lançamento existe para aparecer no caixa.
  const gastosSemCompra = doCarro
    .filter((l) => l.tipo === 'despesa' && l.ref !== `compra:${carro?.id}`)
    .reduce((s, l) => s + num(l.valor), 0);

  const investido = compra + gastosSemCompra;

  return {
    compra,
    gastos: gastosSemCompra,
    gastosBrutos: gastos,
    receitasExtras,
    investido,
    venda,
    vendido,
    lucro: vendido ? venda + receitasExtras - investido : null,
    margem: vendido && venda > 0 ? ((venda + receitasExtras - investido) / venda) * 100 : null,
    itens: doCarro,
  };
}

/** Chave AAAA-MM de um lançamento. */
const mesDe = (l) => String(l?.data ?? '').slice(0, 7);

/**
 * Monta o demonstrativo: uma linha por categoria, uma coluna por mês.
 * Devolve receitas e despesas separadas, cada uma já com totais.
 */
export function demonstrativo(lancamentos, mesInicio, mesFim) {
  const meses = [];
  if (mesInicio && mesFim) {
    const [ai, mi] = mesInicio.split('-').map(Number);
    const [af, mf] = mesFim.split('-').map(Number);
    let a = ai, m = mi;
    // Trava de segurança: intervalo invertido ou digitado errado geraria laço
    // infinito e travaria a aba do lojista.
    for (let i = 0; i < 120 && (a < af || (a === af && m <= mf)); i++) {
      meses.push(`${a}-${String(m).padStart(2, '0')}`);
      m += 1;
      if (m > 12) { m = 1; a += 1; }
    }
  }

  const monta = (tipo) => {
    const doTipo = lancamentos.filter((l) => l.tipo === tipo && meses.includes(mesDe(l)));
    const categorias = [...new Set(doTipo.map((l) => l.categoria))].sort();

    const linhas = categorias.map((cat) => {
      const porMes = Object.fromEntries(meses.map((mes) => [
        mes,
        doTipo.filter((l) => l.categoria === cat && mesDe(l) === mes)
          .reduce((s, l) => s + num(l.valor), 0),
      ]));
      const total = Object.values(porMes).reduce((s, v) => s + v, 0);
      return { categoria: cat, porMes, total };
    }).sort((a, b) => b.total - a.total);

    const totalGeral = linhas.reduce((s, l) => s + l.total, 0);
    const totaisPorMes = Object.fromEntries(meses.map((mes) => [
      mes, linhas.reduce((s, l) => s + l.porMes[mes], 0),
    ]));

    // Percentual sobre o total do tipo: é o que mostra onde o dinheiro está
    // concentrado, que é a pergunta que se faz olhando um demonstrativo.
    linhas.forEach((l) => { l.pct = totalGeral > 0 ? (l.total / totalGeral) * 100 : 0; });

    return { linhas, totaisPorMes, totalGeral };
  };

  const receitas = monta('receita');
  const despesas = monta('despesa');
  const resumoPorMes = Object.fromEntries(meses.map((mes) => [
    mes, (receitas.totaisPorMes[mes] ?? 0) - (despesas.totaisPorMes[mes] ?? 0),
  ]));

  return {
    meses,
    receitas,
    despesas,
    resumoPorMes,
    resultado: receitas.totalGeral - despesas.totalGeral,
  };
}

export const rotuloMes = (mes) => {
  const [a, m] = String(mes).split('-');
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${nomes[Number(m) - 1] ?? m}/${a}`;
};

export const brl = (v) => Number(v || 0).toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 2,
});
