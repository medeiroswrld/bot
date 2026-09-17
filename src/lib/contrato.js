// Geração do contrato de compra e venda.
//
// O modelo é HTML com marcadores {{campo}}, guardado por loja em
// company_settings.contract_template. Renderiza no navegador e imprime pelo
// próprio diálogo do sistema — sem biblioteca de PDF no servidor.
//
// Considerei carimbar texto sobre um PDF pronto (a loja subiria o arquivo dela).
// Descartado: exige coordenada fixa por campo e quebra a cada ajuste de layout.
// HTML é editável, reflui sozinho e imprime igual em qualquer navegador.

const soNumeros = (s) => String(s ?? '').replace(/\D/g, '');

export const formatarCPF = (v) => {
  const d = soNumeros(v).slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};

export const formatarCNPJ = (v) => {
  const d = soNumeros(v).slice(0, 14);
  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};

// Validação real de CPF (dígitos verificadores), não só contagem de caracteres.
// Digitar CPF errado no contrato é problema jurídico, e o erro é fácil de cometer.
export const cpfValido = (v) => {
  const d = soNumeros(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(d[i]) * (10 - i);
  let r = (soma * 10) % 11 % 10;
  if (r !== Number(d[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(d[i]) * (11 - i);
  r = (soma * 10) % 11 % 10;
  return r === Number(d[10]);
};

const UNI = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
  'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
  'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

const trio = (n) => {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), d = n % 100;
  const parteC = CEM[c];
  const parteD = d < 20 ? UNI[d] : DEZ[Math.floor(d / 10)] + (d % 10 ? ` e ${UNI[d % 10]}` : '');
  return [parteC, parteD].filter(Boolean).join(' e ');
};

// Valor por extenso: contrato de venda costuma exigir, e digitar à mão erra.
export const porExtenso = (valor) => {
  const n = Math.floor(Number(valor) || 0);
  const centavos = Math.round(((Number(valor) || 0) - n) * 100);
  if (n === 0 && !centavos) return 'zero reais';

  const milhoes  = Math.floor(n / 1000000);
  const milhares = Math.floor((n % 1000000) / 1000);
  const resto    = n % 1000;

  let txt = '';
  if (milhoes)  txt += `${trio(milhoes)} ${milhoes === 1 ? 'milhão' : 'milhões'}`;
  if (milhares) {
    // Mesma regra do "e" vale entre milhões e milhares: "um milhão E quinhentos
    // mil", mas "um milhão quinhentos e vinte e três mil".
    const usaE = milhares < 100 || milhares % 100 === 0;
    if (txt) txt += usaE ? ' e ' : ' ';
    txt += milhares === 1 ? 'mil' : `${trio(milhares)} mil`;
  }
  if (resto) {
    // O "e" antes do último grupo só entra se ele for menor que cem ou centena
    // redonda: "mil e quinhentos", mas "mil novecentos e noventa".
    const usaE = resto < 100 || resto % 100 === 0;
    if (txt) txt += usaE ? ' e ' : ' ';
    txt += trio(resto);
  }

  // "de reais" só quando o valor é milhão/bilhão redondo: "um milhão DE reais",
  // mas "um milhão e quinhentos mil reais".
  const redondo = n >= 1000000 && n % 1000000 === 0;
  txt += redondo ? ' de ' : ' ';
  txt += n === 1 ? 'real' : 'reais';
  if (centavos) txt += ` e ${trio(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`;
  return txt;
};

const dinheiro = (v) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Modelo padrão. É ponto de partida, NÃO peça jurídica pronta — a loja deve
// passar pelo advogado dela antes de usar. A tela avisa isso.
export const MODELO_PADRAO = `<h1>CONTRATO DE COMPRA E VENDA DE VEÍCULO AUTOMOTOR</h1>

<p><strong>VENDEDOR:</strong> {{loja_nome}}, inscrita no CNPJ sob nº {{loja_cnpj}},
com endereço em {{loja_endereco}}, telefone {{loja_telefone}}.</p>

<p><strong>COMPRADOR:</strong> {{comprador_nome}}, portador do CPF nº {{comprador_cpf}}
e RG nº {{comprador_rg}}, residente em {{comprador_endereco}}, telefone {{comprador_telefone}}.</p>

<h2>1. DO OBJETO</h2>
<p>O presente contrato tem por objeto a venda do veículo abaixo descrito:</p>
<ul>
  <li><strong>Veículo:</strong> {{marca}} {{modelo}} {{versao}}</li>
  <li><strong>Ano:</strong> {{ano}}</li>
  <li><strong>Cor:</strong> {{cor}}</li>
  <li><strong>Placa:</strong> {{placa}}</li>
  <li><strong>Chassi:</strong> {{chassi}}</li>
  <li><strong>Quilometragem:</strong> {{km}} km</li>
</ul>

<h2>2. DO PREÇO E PAGAMENTO</h2>
<p>O valor total da venda é de <strong>R$ {{valor}}</strong> ({{valor_extenso}}),
pago da seguinte forma: {{forma_pagamento}}.</p>

<h2>3. DA ENTREGA E DAS CONDIÇÕES</h2>
<p>O COMPRADOR declara ter vistoriado o veículo, ciente de seu estado de
conservação e da quilometragem indicada, recebendo-o no ato deste instrumento.</p>

<p>A partir da entrega, transferem-se ao COMPRADOR todas as responsabilidades
sobre o veículo, incluindo multas, tributos e encargos posteriores a esta data.</p>

<h2>4. DA TRANSFERÊNCIA</h2>
<p>O COMPRADOR se compromete a providenciar a transferência de titularidade
junto ao órgão de trânsito competente no prazo legal.</p>

<p>E por estarem justos e contratados, firmam o presente em duas vias de igual teor.</p>

<p style="margin-top:32px">{{loja_cidade}}, {{data}}.</p>

<div class="assinaturas">
  <div class="assinatura">
    <div class="linha"></div>
    <p>{{loja_nome}}<br><small>Vendedor</small></p>
  </div>
  <div class="assinatura">
    <div class="linha"></div>
    <p>{{comprador_nome}}<br><small>Comprador</small></p>
  </div>
</div>`;

export const CAMPOS = [
  // Marcadores de LAYOUT, no topo porque são os que a loja mais procura ao
  // colar o contrato dela do Word — e os únicos que texto puro não consegue
  // fazer sozinho.
  ['logo', 'Logo da loja (imagem)'],
  ['assinaturas', 'Bloco de assinaturas (duas colunas)'],
  ['loja_nome', 'Nome da loja'], ['loja_cnpj', 'CNPJ da loja'],
  ['loja_endereco', 'Endereço da loja'], ['loja_telefone', 'Telefone da loja'],
  ['loja_cidade', 'Cidade da loja'],
  ['comprador_nome', 'Nome do comprador'], ['comprador_cpf', 'CPF'],
  ['comprador_rg', 'RG'], ['comprador_endereco', 'Endereço do comprador'],
  ['comprador_telefone', 'Telefone do comprador'], ['comprador_email', 'E-mail do comprador'],
  ['comprador_nascimento', 'Data de nascimento do comprador'],
  ['marca', 'Marca'], ['modelo', 'Modelo'], ['versao', 'Versão'], ['ano', 'Ano'],
  ['cor', 'Cor'], ['placa', 'Placa'], ['chassi', 'Chassi'], ['km', 'Quilometragem'],
  ['renavam', 'Renavam'], ['ano_modelo', 'Ano do modelo'],
  ['combustivel', 'Combustível'],
  ['valor', 'Valor'], ['valor_extenso', 'Valor por extenso'],
  ['valor_tabela', 'Valor de tabela'], ['valor_desconto', 'Valor do desconto'],
  ['hora', 'Hora da assinatura'],
  ['forma_pagamento', 'Forma de pagamento'], ['vendedor', 'Vendedor'], ['data', 'Data da venda'],
  // Veículo recebido em troca. O contrato de loja costuma ter cláusula inteira
  // sobre ele — quem responde por multa até transferir, o que vale se aparecer
  // vício oculto — e sem estes marcadores essas cláusulas saem em branco.
  ['troca_placa', 'Troca: placa'], ['troca_marca', 'Troca: marca'],
  ['troca_modelo', 'Troca: modelo'], ['troca_ano', 'Troca: ano'],
  ['troca_cor', 'Troca: cor'], ['troca_chassi', 'Troca: chassi'],
  ['troca_renavam', 'Troca: renavam'], ['troca_km', 'Troca: quilometragem'],
  ['troca_valor', 'Troca: valor avaliado'], ['troca_valor_extenso', 'Troca: valor por extenso'],
];

/** Troca os {{marcadores}} pelos valores. Marcador sem dado vira ____ em vez de
 *  sumir: espaço em branco num contrato é visível e se preenche à caneta;
 *  marcador apagado passa despercebido e vira cláusula sem sentido. */
export const montarContrato = (modelo, dados) => {
  const bruto = String(modelo || MODELO_PADRAO);

  // A loja cola o contrato dela do Word — texto puro, sem tag nenhuma. Exigir
  // HTML seria exigir que o dono da loja saiba HTML, o que na prática significa
  // que ninguém usaria o campo. Se não parece HTML, converte: linha em branco
  // separa parágrafo, quebra simples vira <br>.
  const pareceHtml = /<\s*(p|div|h[1-6]|ul|ol|table|br|strong|em)\b/i.test(bruto);
  let html = pareceHtml
    ? bruto
    : bruto
        .split(/\n\s*\n/)
        .map((par) => par.trim())
        .filter(Boolean)
        .map((par) => `<p>${par.replace(/\n/g, '<br>')}</p>`)
        .join('\n');

  // ── Marcadores de LAYOUT ────────────────────────────────────────────────
  //
  // `{{logo}}` e `{{assinaturas}}` não são dados, são estrutura. Passassem pelo
  // substituidor comum, virariam "________" — que foi exatamente o que saiu no
  // contrato da Leandrinho: dois traços e "ASS VENDEDOR ASS COMPRADOR"
  // espremidos numa linha só, porque o lojista digitou os underscores no Word e
  // texto puro não faz coluna.
  //
  // O CSS de impressão já tem `.assinaturas` em duas colunas desde sempre; o
  // que faltava era alguém emitir esse HTML.
  const blocoAssinaturas = () => {
    const col = (rotulo, nome) => `<div class="assinatura">`
      + `<div class="linha"></div>`
      + `<p>${rotulo}</p>`
      + (nome ? `<p><small>${nome}</small></p>` : '')
      + `</div>`;
    // O nome embaixo da linha é o que o contrato de papel não tinha: quem lê
    // depois não precisa adivinhar de quem é a assinatura.
    return `<div class="assinaturas">`
      + col('ASS. VENDEDOR', dados.loja_nome)
      + col('ASS. COMPRADOR', dados.comprador_nome)
      + `</div>`;
  };

  const blocoLogo = () => (dados.loja_logo
    ? `<div class="logo"><img src="${dados.loja_logo}" alt=""></div>`
    // Sem logo cadastrada não deixa buraco nem traço: some.
    : '');

  html = html
    // Consome o <p> em volta: o bloco é de nível superior, e um <div> dentro de
    // <p> faz o navegador fechar o parágrafo antes da hora, bagunçando o espaço.
    .replace(/<p>\s*\{\{\s*assinaturas\s*\}\}\s*<\/p>/gi, blocoAssinaturas)
    .replace(/\{\{\s*assinaturas\s*\}\}/gi, blocoAssinaturas)
    .replace(/<p>\s*\{\{\s*logo\s*\}\}\s*<\/p>/gi, blocoLogo)
    .replace(/\{\{\s*logo\s*\}\}/gi, blocoLogo);

  return html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, campo) => {
    const v = dados[campo];
    return v === undefined || v === null || v === '' ? '________' : String(v);
  });
};

/** Junta loja + veículo + comprador no formato dos marcadores. */
export const dadosDoContrato = ({ loja, carro, venda }) => ({
  loja_nome: loja?.company_name ?? '',
  loja_cnpj: loja?.cnpj ? formatarCNPJ(loja.cnpj) : '',
  loja_endereco: loja?.address ?? '',
  loja_telefone: loja?.phone_number ?? '',
  // Cidade sai do endereço quando não há campo próprio: melhor aproximar do que
  // deixar em branco no fecho do contrato.
  loja_cidade: (loja?.address ?? '').split(',').slice(-2, -1)[0]?.trim() || (loja?.address ?? ''),
  // Usada pelo marcador {{logo}}. Não é campo de texto: vira <img>.
  loja_logo: loja?.logo_url ?? '',

  comprador_nome: venda?.buyer_name ?? '',
  comprador_cpf: venda?.buyer_cpf ? formatarCPF(venda.buyer_cpf) : '',
  comprador_rg: venda?.buyer_rg ?? '',
  comprador_endereco: venda?.buyer_address ?? '',
  comprador_telefone: venda?.buyer_phone ?? '',
  comprador_email: venda?.buyer_email ?? '',
  // Alguns contratos pedem a data de nascimento na qualificacao do comprador.
  comprador_nascimento: venda?.buyer_birth_date
    ? new Date(`${venda.buyer_birth_date}T12:00`).toLocaleDateString('pt-BR')
    : '',

  marca: carro?.brand ?? '',
  modelo: carro?.model ?? '',
  versao: carro?.version ?? '',
  ano: carro?.year ?? '',
  cor: carro?.color ?? '',
  placa: carro?.plate ?? '',
  chassi: carro?.chassi ?? '',
  km: carro?.mileage != null ? Number(carro.mileage).toLocaleString('pt-BR') : '',

  renavam: carro?.renavam ?? '',
  ano_modelo: carro?.model_year ?? '',
  combustivel: carro?.fuel ?? '',

  troca_placa:  venda?.trade_in_plate ?? '',
  troca_marca:  venda?.trade_in_brand ?? '',
  troca_modelo: venda?.trade_in_model ?? '',
  troca_ano:    venda?.trade_in_year ?? '',
  troca_cor:    venda?.trade_in_color ?? '',
  troca_chassi: venda?.trade_in_chassi ?? '',
  troca_renavam: venda?.trade_in_renavam ?? '',
  troca_km: venda?.trade_in_km != null && venda.trade_in_km !== ''
    ? Number(venda.trade_in_km).toLocaleString('pt-BR') : '',
  troca_valor: venda?.trade_in_value ? dinheiro(venda.trade_in_value) : '',
  troca_valor_extenso: venda?.trade_in_value ? porExtenso(venda.trade_in_value) : '',

  // Preco de tabela e desconto. Contratos mais completos discriminam os tres
  // valores, e os dois primeiros ja existem: o `price` do carro e o anunciado,
  // e o desconto e a diferenca ate o que foi efetivamente pago. Desconto
  // negativo (vendeu acima do anunciado) sai vazio em vez de virar numero com
  // sinal, que num contrato pareceria erro de digitacao.
  valor_tabela: carro?.price ? dinheiro(carro.price) : '',
  valor_desconto: (() => {
    const tabela = Number(carro?.price ?? 0);
    const pago   = Number(venda?.salePrice ?? 0);
    const dif = tabela - pago;
    return tabela > 0 && dif > 0 ? dinheiro(dif) : '';
  })(),

  // Hora da assinatura. A clausula de responsabilidade civil costuma marcar
  // data E hora, porque e a partir dali que multa passa a ser do comprador.
  hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),

  valor: dinheiro(venda?.salePrice),
  valor_extenso: porExtenso(venda?.salePrice),
  forma_pagamento: venda?.payment_terms ?? '',
  vendedor: venda?.sellerName ?? '',
  data: venda?.saleDate
    ? new Date(`${String(venda.saleDate).slice(0, 10)}T12:00`).toLocaleDateString('pt-BR')
    : new Date().toLocaleDateString('pt-BR'),
});

/** Abre o contrato pronto numa janela e chama a impressão do navegador. */
export const imprimirContrato = (html) => {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) { alert('O navegador bloqueou a janela. Libere os pop-ups para imprimir o contrato.'); return; }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Contrato de Compra e Venda</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 11.5pt; line-height: 1.6; color: #111; }
  h1 { font-size: 14pt; text-align: center; margin: 0 0 22px; }
  h2 { font-size: 12pt; margin: 20px 0 6px; }
  ul { margin: 6px 0 0 18px; padding: 0; }
  li { margin-bottom: 3px; }
  p { margin: 0 0 10px; text-align: justify; }
  .assinaturas { display: flex; gap: 40px; margin-top: 54px; page-break-inside: avoid; }
  .assinatura { flex: 1; text-align: center; }
  .linha { border-top: 1px solid #111; margin-bottom: 6px; }
  .assinatura p { text-align: center; margin: 0; }
  small { color: #444; }
  /* Logo da loja. Altura limitada e largura automática: a loja sobe o arquivo
     que tem, e um PNG grande demais empurraria o contrato pra segunda página. */
  .logo { margin: 0 0 14px; }
  .logo img { max-height: 60px; max-width: 45%; object-fit: contain; }
</style></head><body>${html}</body></html>`);
  w.document.close();
  // Espera o layout assentar: chamar print() antes disso imprime página em branco
  // em alguns navegadores.
  w.onload = () => setTimeout(() => w.print(), 120);
};
