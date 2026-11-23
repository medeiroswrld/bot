// Ficha impressa do veículo — UMA folha por carro, pra colar no vidro.
//
// Por que uma folha por carro e não uma lista: a ficha vive NO CARRO. Quem está
// parado na frente do Onix quer saber do Onix, de longe, sem precisar chamar
// ninguém. Lista impressa é catálogo — serve pro vendedor, não pro cliente
// andando no pátio num sábado de feirão.
//
// O QUE A FOLHA PRIORIZA, e por quê:
//
// A pessoa está OLHANDO o carro. Então a foto é o item de MENOR valor da
// folha — ela mostra o que a pessoa já está vendo. O que ela não consegue
// saber olhando é preço, ano, quilometragem, e COMO AGIR sem ter que caçar um
// vendedor no meio de um pátio cheio.
//
// Daí a ordem: preço gigante (a pergunta nº 1, lida de longe), especificações
// em caixas de bater o olho, as condições do evento, e um QR que abre o
// WhatsApp JÁ falando daquele carro. Esse QR é o que transforma papel em lead:
// quem não quer falar com vendedor, quem passou no domingo à noite com a loja
// fechada, e quem só quer pensar em casa — todos viram conversa.
//
// Campo vazio NÃO vira linha em branco nem "—": a caixa some. Ficha com buraco
// parece desleixo da loja, e o cliente repara.

const semValor = (v) => v === null || v === undefined || String(v).trim() === '';

const dinheiro = (valor, moeda = 'BRL', locale = 'pt-BR') => {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency: moeda, minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `R$ ${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
  }
};

const km = (v) => {
  const n = Number(String(v ?? '').replace(/\D/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${n.toLocaleString('pt-BR')} km`;
};

// Escapa o que vem do banco. O lojista digita o que quiser na descrição, e um
// "<" solto quebraria a folha inteira em silêncio.
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

// Número pro wa.me: precisa de DDI. Telefone brasileiro guardado sem o 55
// (11 dígitos) ganha o prefixo; com 12 ou 13 já vem completo.
const paraWhatsApp = (telefone) => {
  const d = soDigitos(telefone);
  if (d.length === 0) return '';
  if (d.length <= 11) return `55${d}`;
  return d;
};

const tituloDoCarro = (car) => [car.brand, car.model].filter(Boolean)
  .map((s) => String(s).trim()).join(' ').replace(/\s+/g, ' ');

/**
 * QR do WhatsApp daquele carro, como data: URI.
 *
 * Import DINÂMICO: a biblioteca só entra quando alguém imprime, e não pesa o
 * sistema no dia a dia de quem nunca usa a ficha.
 *
 * Devolve '' em qualquer falha — e a ficha então cai pro número escrito. QR
 * quebrado NÃO pode impedir a loja de imprimir na véspera do feirão.
 */
async function qrDoCarro(car, telefone) {
  const numero = paraWhatsApp(telefone);
  if (!numero) return '';
  try {
    const { default: QRCode } = await import('qrcode');
    const texto = `Olá! Tenho interesse no ${tituloDoCarro(car)}${car.year ? ` ${car.year}` : ''}.`;
    const url = `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 420,          // folgado: QR impresso pequeno demais não lê
      color: { dark: '#111111', light: '#FFFFFF' },
    });
  } catch {
    return '';
  }
}

function fichaDeUmCarro(car, loja, qr) {
  const titulo = tituloDoCarro(car).toUpperCase();
  const versao = String(car.version ?? '').trim();

  // Ano: "2019" quando fabricação e modelo são iguais, "2019/2020" quando
  // diferem. É como a placa e o anúncio escrevem, e o cliente confere um
  // contra o outro.
  const anoFab = String(car.year ?? '').trim();
  const anoMod = String(car.model_year ?? '').trim();
  const ano = anoFab && anoMod && anoFab !== anoMod ? `${anoFab}/${anoMod}` : (anoFab || anoMod);

  const specs = [
    ['Ano',           ano],
    ['Quilometragem', km(car.mileage)],
    ['Câmbio',        car.transmission],
    ['Combustível',   car.fuel],
    ['Cor',           car.color],
  ].filter(([, v]) => !semValor(v));

  const telefoneVisivel = String(loja.telefone ?? '').trim();

  return `
<section class="ficha">
  ${loja.logo ? `
  <div class="marca">
    <img class="logo" src="${esc(loja.logo)}" alt="">
    ${loja.evento ? `<span class="marca-evento">${esc(loja.evento)}</span>` : ''}
  </div>` : ''}

  <header class="topo">
    <div class="identidade">
      <h1>${esc(titulo)}</h1>
      ${versao ? `<p class="versao">${esc(versao)}</p>` : ''}
    </div>
    ${!loja.logo && loja.nome ? `<span class="loja-texto">${esc(loja.nome)}</span>` : ''}
  </header>

  <div class="preco">
    <span class="rotulo">Valor</span>
    <strong>${esc(dinheiro(car.price, loja.moeda, loja.locale))}</strong>
  </div>

  ${specs.length ? `
  <div class="specs">
    ${specs.map(([r, v]) => `
      <div class="spec"><span>${esc(r)}</span><strong>${esc(v)}</strong></div>`).join('')}
  </div>` : ''}

  ${loja.condicoes ? `
  <div class="condicoes">
    ${/* O nome do evento já aparece na faixa da marca quando há logo. Repetir
          duas vezes na mesma folha é ruído — aqui ele só entra como reserva,
          pra loja sem logo cadastrada não perder a referência do evento. */''}
    ${(loja.evento && !loja.logo) ? `<span class="selo">${esc(loja.evento)}</span>` : ''}
    <p>${esc(loja.condicoes)}</p>
  </div>` : ''}

  ${(qr || telefoneVisivel) ? `
  <div class="chamada">
    ${qr ? `<img class="qr" src="${qr}" alt="">` : ''}
    <div class="chamada-texto">
      <strong>Gostou deste?</strong>
      <p>${qr ? 'Aponte a câmera do celular e fale com a gente agora — já vem com este veículo na mensagem.' : 'Fale com a gente pelo WhatsApp.'}</p>
      ${telefoneVisivel ? `<p class="fone">${esc(telefoneVisivel)}</p>` : ''}
    </div>
  </div>` : ''}

  <footer class="rodape">
    <span>${esc(loja.nome ?? '')}</span>
    ${loja.site ? `<span>${esc(loja.site)}</span>` : ''}
  </footer>
</section>`;
}

/**
 * Monta o HTML das fichas — uma por carro, uma por página.
 *
 * É assíncrona por causa do QR, que é gerado por veículo (cada um leva o nome
 * do próprio carro na mensagem). Os QRs saem TODOS de uma vez, não um a um:
 * com 38 carros em série a espera era perceptível.
 */
export async function montarFichas(carros, loja = {}) {
  const lista = carros ?? [];
  const qrs = await Promise.all(lista.map((c) => qrDoCarro(c, loja.telefone)));
  return lista.map((c, i) => fichaDeUmCarro(c, loja, qrs[i])).join('\n');
}

/** O CSS da folha, exportado pra pré-visualização poder usar o mesmo. */
export const CSS_FICHA = `
  /* Identidade da loja.
     Trocar estas duas variaveis muda a ficha inteira — e e o unico lugar a
     mexer quando a proxima loja tiver outra cor. */
  :root { --marca: #f4661b; --tinta: #08080a; }

  /* SEM ISTO O FUNDO ESCURO NAO IMPRIME.
     O navegador descarta cor de FUNDO na impressao por padrao (economia de
     tinta) — cor de TEXTO e de BORDA ele mantem. Foi o que aconteceu na
     primeira prova impressa: o laranja do preco saiu, mas a faixa preta do
     topo virou branca, e o logo (que e claro) sumiu dentro dela. Parecia logo
     "muito claro"; era fundo que nao imprimiu. */
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* DUAS FICHAS POR FOLHA, cada uma em pe.
     A folha vai na janela do carro: meia folha basta e rende o dobro. Cada
     ficha fica 138x194mm — proporcao de A5 em pe — e duas ficam lado a lado
     numa A4 DEITADA. */
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
    color: var(--tinta);
    display: flex; flex-wrap: wrap; align-content: flex-start; gap: 0 5mm;
  }

  .ficha {
    width: 138mm; height: 194mm;
    display: flex; flex-direction: column;
    page-break-inside: avoid; break-inside: avoid;
  }
  /* Quebra a cada DUAS, nao a cada uma: e isso que poe duas por folha. */
  .ficha:nth-child(2n) { page-break-after: always; break-after: page; }
  .ficha:last-child    { page-break-after: auto;   break-after: auto; }

  /* Faixa da marca.
     O logo da DSC e texto CLARO com o carro laranja — no papel branco o nome
     sumiria e sobraria so o carro. Entao ele vive numa faixa escura, que e
     como o site dele aparece. Faixa, e nao folha inteira escura: fundo preto
     em pagina cheia gasta uma fortuna de toner e sai borrado. */
  .marca {
    background: var(--tinta); border-radius: 1.5mm;
    padding: 3mm 4mm; margin-bottom: 4mm;
    display: flex; align-items: center; justify-content: space-between; gap: 3mm;
  }
  .marca .logo { height: 9mm; max-width: 52mm; object-fit: contain; }
  .marca-evento {
    color: var(--marca); font-size: 7.5pt; font-weight: 800;
    letter-spacing: 1.2px; text-transform: uppercase; text-align: right; line-height: 1.2;
  }
  .loja-texto { font-size: 10pt; color: #666; white-space: nowrap; }

  .topo { display: flex; align-items: flex-start; justify-content: space-between; gap: 5mm; }
  .identidade h1 { font-size: 19pt; line-height: 1.08; margin: 0; letter-spacing: -0.4px; }
  .versao { font-size: 10pt; color: #555; margin: 2px 0 0; text-transform: uppercase; letter-spacing: 0.4px; }

  /* O preco e o maior elemento da folha de proposito: e o que a pessoa procura
     primeiro, e normalmente de dois metros de distancia. Na cor da marca, que
     e o que carrega a identidade quando o fundo e branco. */
  .preco {
    margin-top: auto; padding: 4mm 0 2.5mm; border-top: 2.5pt solid var(--marca);
    display: flex; align-items: baseline; justify-content: space-between;
  }
  .preco .rotulo { font-size: 9pt; text-transform: uppercase; letter-spacing: 1.6px; color: #666; }
  .preco strong { font-size: 34pt; line-height: 1; letter-spacing: -1.2px; color: var(--marca); }

  /* Especificacoes em grade de 3: com 5 itens numa folha de 138mm, uma linha
     so apertaria cada caixa a ponto de o valor quebrar em duas linhas. */
  .specs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm; margin-top: 3mm; }
  .spec { border: 0.75pt solid #ddd; border-radius: 1.5mm; padding: 2mm 1.5mm 2.5mm; text-align: center; }
  .spec span { display: block; font-size: 6.5pt; text-transform: uppercase; letter-spacing: 0.8px; color: #777; }
  .spec strong { display: block; font-size: 10.5pt; margin-top: 1mm; }

  .condicoes {
    margin-top: 3mm; padding: 3mm 3.5mm; border-radius: 1.5mm;
    background: var(--tinta); color: #f2f2f4;
  }
  .condicoes .selo {
    display: inline-block; font-size: 7pt; font-weight: 800; letter-spacing: 1.2px;
    text-transform: uppercase; color: var(--marca); margin-bottom: 1mm;
  }
  .condicoes p { margin: 0; font-size: 8.5pt; line-height: 1.4; }

  .chamada {
    margin-top: 3mm; display: flex; align-items: center; gap: 3mm;
    border: 1.2pt solid var(--marca); border-radius: 1.5mm; padding: 2.5mm 3mm;
  }
  .chamada .qr { width: 22mm; height: 22mm; flex-shrink: 0; }
  .chamada-texto strong { display: block; font-size: 10pt; color: var(--marca); }
  .chamada-texto p { margin: 0.8mm 0 0; font-size: 7.5pt; color: #555; line-height: 1.35; }
  .chamada-texto .fone { font-size: 11.5pt; font-weight: 700; color: var(--tinta); margin-top: 1mm; letter-spacing: 0.2px; }

  .rodape {
    margin-top: 3mm; padding-top: 2mm; border-top: 0.75pt solid #ddd;
    display: flex; justify-content: space-between; font-size: 8pt; color: #666;
  }
`;

/**
 * Abre as fichas numa janela e manda imprimir.
 *
 * Espera as FOTOS carregarem antes de chamar print(): as imagens vêm do
 * storage, e imprimir antes delas assentarem sai com retângulo em branco onde
 * deveria estar o carro. O `onload` sozinho não garante isso quando a janela é
 * escrita por document.write.
 */
export function imprimirFichas(html, { titulo = 'Fichas do estoque' } = {}) {
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) {
    alert('O navegador bloqueou a janela. Libere os pop-ups para imprimir as fichas.');
    return false;
  }

  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(titulo)}</title>
<style>${CSS_FICHA}</style></head><body>${html}</body></html>`);
  w.document.close();

  const imprimir = () => setTimeout(() => { try { w.print(); } catch { /* usuário fechou a janela */ } }, 150);
  const imgs = Array.from(w.document.images ?? []);
  const pendentes = imgs.filter((i) => !i.complete);

  if (pendentes.length === 0) { imprimir(); return true; }

  let faltam = pendentes.length;
  // Teto de 8s: foto que não carrega não pode deixar a janela pendurada pra
  // sempre — melhor imprimir sem ela do que não imprimir.
  const limite = setTimeout(imprimir, 8000);
  const pronto = () => {
    faltam -= 1;
    if (faltam <= 0) { clearTimeout(limite); imprimir(); }
  };
  pendentes.forEach((img) => {
    img.addEventListener('load', pronto, { once: true });
    img.addEventListener('error', pronto, { once: true });
  });
  return true;
}
