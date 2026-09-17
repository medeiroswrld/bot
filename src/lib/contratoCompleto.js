// Segundo modelo de contrato: a versão completa, com as cláusulas que loja com
// jurídico costuma exigir — responsabilidade civil e criminal com data e hora,
// cláusula resolutiva, depósito, LGPD, foro de eleição, autorização de imagem e
// duas testemunhas.
//
// Vive em arquivo próprio porque são 150 linhas de texto jurídico. Misturado ao
// `contrato.js`, ele afogaria a lógica de montagem, que é a parte que alguém
// realmente precisa ler quando algo dá errado.
//
// ── Duas coisas foram trocadas ao virar modelo ──────────────────────────────
//
// Veio do contrato real de uma revenda, e tinha dois problemas que só aparecem
// quando um documento específico vira modelo para todo mundo:
//
//   1. A razão social, o CNPJ e o endereço da loja de origem estavam fixos no
//      texto. Modelo com CNPJ de outra empresa dentro não é contrato, é defeito
//      — agora são {{loja_nome}}, {{loja_cnpj}} e {{loja_endereco}}.
//
//   2. A cláusula de imagem trazia NOME, RG e CPF de uma cliente de verdade.
//      Num modelo, esses dados apareceriam no contrato de todos os compradores
//      seguintes — inclusive na cláusula de LGPD logo acima, que promete
//      exatamente o contrário. Viraram {{comprador_*}}.
//
// Continua valendo o aviso do outro modelo, e a tela repete: é ponto de
// partida, NÃO peça jurídica pronta. O advogado da loja precisa ler antes.

export const MODELO_COMPLETO = `{{logo}}
<h1>CONTRATO DE COMPRA E VENDA</h1>

<p><strong>VENDEDOR:</strong> {{loja_nome}}, pessoa jurídica de direito privado,
inscrita no CNPJ {{loja_cnpj}}, com sede em {{loja_endereco}}.</p>

<p><strong>COMPRADOR:</strong> {{comprador_nome}}, RG/IE nº {{comprador_rg}},
inscrito no CPF/CNPJ sob o nº {{comprador_cpf}}, com endereço em
{{comprador_endereco}}, telefone {{comprador_telefone}}.</p>

<p>As partes acima referidas e qualificadas resolvem entabular a presente compra
e venda na forma e termos a seguir expostos:</p>

<h2>CLÁUSULA PRIMEIRA — DO OBJETO</h2>
<ul>
  <li><strong>Marca:</strong> {{marca}}</li>
  <li><strong>Modelo:</strong> {{modelo}} {{versao}}</li>
  <li><strong>Cor:</strong> {{cor}}</li>
  <li><strong>Combustível:</strong> {{combustivel}}</li>
  <li><strong>Vendedor:</strong> {{vendedor}}</li>
  <li><strong>Data da venda:</strong> {{data}}</li>
  <li><strong>Ano Fab/Mod:</strong> {{ano}}/{{ano_modelo}}</li>
  <li><strong>Km:</strong> {{km}}</li>
  <li><strong>Placa:</strong> {{placa}}</li>
  <li><strong>Renavam:</strong> {{renavam}}</li>
  <li><strong>Chassi:</strong> {{chassi}}</li>
</ul>

<h2>CLÁUSULA SEGUNDA — DO PREÇO E FORMA DE PAGAMENTO</h2>
<ul>
  <li>R$ {{valor_tabela}} valor de tabela</li>
  <li>R$ {{valor_desconto}} valor do desconto</li>
  <li><strong>R$ {{valor}} valor da venda</strong> ({{valor_extenso}})</li>
</ul>
<p>O pagamento se dará da seguinte forma: {{forma_pagamento}}</p>

<h2>CLÁUSULA TERCEIRA — DA VISTORIA E AVALIAÇÃO DO VEÍCULO</h2>
<p>O COMPRADOR declara ter testado, vistoriado e avaliado o estado em que se
encontra o veículo ora negociado, estando o mesmo em perfeitas condições de
funcionamento e estado de conservação, atentando-se às características
peculiares e específicas do veículo em questão.</p>

<h2>CLÁUSULA QUARTA — DA RESPONSABILIDADE CIVIL E CRIMINAL</h2>
<p>A partir desta data {{data}} e hora {{hora}}, o COMPRADOR se responsabiliza
por quaisquer danos, seja no âmbito civil ou penal, decorrentes da utilização do
veículo ora adquirido, inclusive multas e pontuações na CNH decorrentes de tais
infrações, sejam elas de âmbito Municipal, Estadual e/ou Federal, bem como fica
responsável também, nos mesmos termos acima, até a presente data e hora, por
eventual veículo dado na compra do objeto do presente, respondendo ainda o
comprador pela evicção e eventuais vícios redibitórios do mesmo. O VENDEDOR,
acaso tenha recebido algum veículo do COMPRADOR como forma de pagamento do bem
objeto do presente, fica responsável por quaisquer danos, seja no âmbito civil
ou penal, decorrentes da utilização do veículo ora recebido, inclusive multas e
pontuações na CNH decorrentes de tais infrações, sejam elas de âmbito Municipal,
Estadual e/ou Federal. Deste modo, o presente instrumento é firmado nos termos
do artigo 784, III do CPC, razão pela qual é um título executivo extrajudicial,
mesmo porque o "quantum debeatur" depende de simples cálculo aritmético, a
partir de dados consignados em documentos comprobatórios do débito (multas de
trânsito, IPVA, licenciamento e outros). Nesta seara, a VENDEDORA poderá
executar o presente para cobrança de eventuais valores encontrados e de
responsabilidade do COMPRADOR.</p>

<h2>CLÁUSULA QUINTA — DA GARANTIA</h2>
<p>O COMPRADOR está ciente de que os termos desta negociação isentam o VENDEDOR
de qualquer tipo de garantia, sendo que os mesmos foram pré-requisitos da
efetivação do negócio, sem prejuízo ao artigo 24 do Código de Defesa do
Consumidor no que diz respeito à garantia legal.</p>

<h2>CLÁUSULA SEXTA — DA TRANSFERÊNCIA DO BEM</h2>
<p>A transferência do bem objeto do presente instrumento para o nome do
comprador, ou de alguém por ele determinado, só se dará após a total quitação do
bem descrito na cláusula primeira deste, sendo que, na hipótese de pagamento em
cheque(s) ou qualquer outro título de crédito, após a compensação ou quitação
do(s) mesmo(s).</p>

<h2>CLÁUSULA SÉTIMA — DA CLÁUSULA RESOLUTIVA</h2>
<p>As partes VENDEDOR(A) e COMPRADOR(A) estabelecem desde já que, no caso de não
cumprimento do presente quanto aos pagamentos devidos pelo COMPRADOR ao VENDEDOR
na forma e prazos estabelecidos no bojo deste instrumento particular de
contrato, os quais foram avençados de comum acordo entre as partes, permitirá ao
VENDEDOR, como melhor lhe aprouver, pedir a resolução do contrato ou, se
preferir, exigir o cumprimento do mesmo, independentemente de notificação ou
interpelação, nos termos do que reza o artigo 475 do Código Civil. Fica desde já
avençado entre estas partes que, na hipótese de resolução do contrato, em se
tratando de veículo usado, o COMPRADOR deverá pagar ao VENDEDOR, até a devolução
do bem objeto deste instrumento, o valor diário pelo uso do veículo na base de
0,5% (meio por cento) sobre o valor do mesmo; em se tratando de veículo novo
(0 km), o COMPRADOR deverá pagar ao VENDEDOR, até a devolução do bem objeto
deste instrumento, o valor diário pelo uso do veículo na base de 0,5% (meio por
cento) sobre o valor do bem, mais o valor decorrente da depreciação sofrida pelo
veículo em razão de não ser mais o mesmo um bem 0 km, servindo-se para tal
verificação (depreciação) a tabela FIPE atualizada.</p>

<h2>CLÁUSULA OITAVA — DO DEPÓSITO</h2>
<p>Nos termos do que estabelece o artigo 629 do Código Civil, o COMPRADOR assume,
de forma gratuita, a condição de depositário do bem objeto do presente,
obrigando-se pela guarda e conservação do mesmo até o integral pagamento do
preço.</p>

<h2>CLÁUSULA NONA — SITUAÇÃO DE REGULARIDADE</h2>
<ul>
  <li>Valor aproximado dos tributos: ______________________</li>
  <li>Furto: ______________________</li>
  <li>Multas e taxas anuais em aberto: ______________________</li>
  <li>Alienação fiduciária: ______________________</li>
  <li>Outros registros impeditivos à circulação do veículo: ______________________</li>
</ul>

<h2>CLÁUSULA DÉCIMA — LEI GERAL DE PROTEÇÃO DE DADOS</h2>
<p>A empresa VENDEDORA em questão está em conformidade com a Lei 13.709/2018 —
LGPD, protegendo os direitos fundamentais de liberdade e de privacidade e o
livre desenvolvimento da personalidade da pessoa natural no que diz respeito às
operações realizadas com os dados pessoais armazenados de forma física ou
digital ora fornecidos para o fim de elaborar este documento e realizar os
trâmites necessários para a perfeita prestação de serviços contratada em
questão. Em respeito ao artigo 7º, inciso I, e ao artigo 8º, § 1º da aludida
Lei, tais dados serão utilizados somente, e tão somente, com a finalidade de
manutenção necessária para este contrato, estando o titular autorizando e dando
sua ciência de fornecimento para este fim específico.</p>

<h2>CLÁUSULA DÉCIMA PRIMEIRA — FORO DE ELEIÇÃO</h2>
<p>Para dirimir quaisquer dúvidas decorrentes do presente, as partes estabelecem
desde já, com exclusividade, o foro da Comarca da VENDEDORA, por mais
privilegiado que outro possa ser. O COMPRADOR, de livre e espontânea vontade,
RENUNCIA ao foro previsto no artigo 101, I do Código de Defesa do Consumidor.</p>

<h2>CLÁUSULA DÉCIMA SEGUNDA — IMAGEM</h2>
<p>Fica autorizada a {{loja_nome}} a utilizar a imagem, em todo e qualquer
material, entre imagens de vídeo e fotos, do bem deste contrato e do próprio
cliente {{comprador_nome}}, RG/IE nº {{comprador_rg}}, inscrito no CPF/CNPJ sob
o nº {{comprador_cpf}}, para fins de anúncio em plataformas digitais e
divulgação. A presente autorização é concedida a título gratuito, abrangendo o
uso da imagem acima mencionada em todo o território nacional e no exterior, em
todas as suas modalidades e, em destaque, das seguintes formas: (I) home page;
(II) cartazes; (III) redes sociais; (IV) divulgação em geral; (V) foto;
(VI) vídeos; (VII) fotos e vídeos da negociação e da venda. Fica autorizada, de
livre e espontânea vontade, a veiculação das imagens, não recebendo para tanto
qualquer tipo de remuneração.</p>

<p>E, para que produza seus legais efeitos, firmo o presente termo, na presença
de 2 (duas) testemunhas.</p>

<p style="margin-top:24px">{{loja_cidade}}, {{data}}.</p>

<div class="assinaturas">
  <div class="assinatura">
    <div class="linha"></div>
    <p>{{comprador_nome}}<br><small>CPF: {{comprador_cpf}}</small></p>
  </div>
  <div class="assinatura">
    <div class="linha"></div>
    <p>{{loja_nome}}<br><small>CNPJ: {{loja_cnpj}}</small></p>
  </div>
</div>

<div class="assinaturas">
  <div class="assinatura">
    <div class="linha"></div>
    <p>Testemunha 1<br><small>RG/CPF</small></p>
  </div>
  <div class="assinatura">
    <div class="linha"></div>
    <p>Testemunha 2<br><small>RG/CPF</small></p>
  </div>
</div>`;
