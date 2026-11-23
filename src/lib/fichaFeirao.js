// Ficha impressa do veículo — UMA folha por carro, pra colar no vidro.
//
// Por que uma folha por carro e não uma lista: a ficha vive NO CARRO. Quem está
// parado na frente do Onix quer saber do Onix, de longe, sem precisar chamar
// ninguém. Lista impressa é catálogo — serve pro vendedor, não pro cliente
// andando no pátio num sábado de feirão.
//
// As decisões de layout vêm daí:
//   - o PREÇO é o maior elemento da folha. É a primeira coisa que a pessoa
//     procura, e geralmente de dois metros de distância;
//   - as especificações são rótulo em cima, valor embaixo, em caixa — dá pra
//     bater o olho e achar "km" sem ler a folha inteira;
//   - campo vazio NÃO vira linha em branco nem "—": a caixa some. Ficha com
//     buraco parece desleixo da loja, e o cliente repara.

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

const primeirasImagens = (car, quantas = 2) => {
  const imgs = Array.isArray(car?.images) ? car.images : [];
  return imgs.map((i) => (typeof i === 'string' ? i : i?.url)).filter(Boolean).slice(0, quantas);
};

function fichaDeUmCarro(car, loja) {
  const fotos = primeirasImagens(car, 2);
  const titulo = [car.brand, car.model].filter(Boolean).join(' ').toUpperCase();
  const versao = String(car.version ?? '').trim();

  // Ano: "2019" quando ano de fabricação e modelo são iguais, "2019/2020"
  // quando diferem. É assim que a placa e o anúncio escrevem, e o cliente
  // confere um contra o outro.
  const anoFab = String(car.year ?? '').trim();
  const anoMod = String(car.model_year ?? '').trim();
  const ano = anoFab && anoMod && anoFab !== anoMod ? `${anoFab}/${anoMod}` : (anoFab || anoMod);

  const specs = [
    ['Ano',          ano],
    ['Quilometragem', km(car.mileage)],
    ['Câmbio',       car.transmission],
    ['Combustível',  car.fuel],
    ['Cor',          car.color],
  ].filter(([, v]) => !semValor(v));

  return `
<section class="ficha">
  <header class="topo">
    <div class="identidade">
      <h1>${esc(titulo)}</h1>
      ${versao ? `<p class="versao">${esc(versao)}</p>` : ''}
    </div>
    ${loja.logo ? `<img class="logo" src="${esc(loja.logo)}" alt="">` : ''}
  </header>

  ${fotos.length ? `
  <div class="fotos ${fotos.length > 1 ? 'duas' : 'uma'}">
    ${fotos.map((u, i) => `<img src="${esc(u)}" alt="" class="${i === 0 ? 'principal' : 'secundaria'}">`).join('')}
  </div>` : '<div class="sem-foto">Sem foto cadastrada</div>'}

  <div class="preco">
    <span class="rotulo">Valor</span>
    <strong>${esc(dinheiro(car.price, loja.moeda, loja.locale))}</strong>
  </div>

  ${specs.length ? `
  <div class="specs">
    ${specs.map(([r, v]) => `
      <div class="spec"><span>${esc(r)}</span><strong>${esc(v)}</strong></div>`).join('')}
  </div>` : ''}

  <footer class="rodape">
    <span>${esc(loja.nome ?? '')}</span>
    ${loja.site ? `<span>${esc(loja.site)}</span>` : ''}
  </footer>
</section>`;
}

/** Monta o HTML das fichas — uma por carro, uma por página. */
export function montarFichas(carros, loja = {}) {
  return (carros ?? []).map((c) => fichaDeUmCarro(c, loja)).join('\n');
}

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
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', Arial, Helvetica, sans-serif; color: #111; }

  /* Uma ficha por folha. O "avoid" no conteudo impede que o navegador parta a
     ficha ao meio quando a foto e alta. */
  .ficha {
    page-break-after: always; break-after: page;
    page-break-inside: avoid; break-inside: avoid;
    height: 273mm; display: flex; flex-direction: column;
  }
  .ficha:last-child { page-break-after: auto; break-after: auto; }

  .topo { display: flex; align-items: flex-start; justify-content: space-between; gap: 12mm; }
  .identidade h1 { font-size: 30pt; line-height: 1.05; margin: 0; letter-spacing: -0.5px; }
  .versao { font-size: 13pt; color: #555; margin: 4px 0 0; text-transform: uppercase; letter-spacing: 0.5px; }
  .logo { max-height: 22mm; max-width: 45mm; object-fit: contain; }

  .fotos { display: flex; gap: 4mm; margin: 7mm 0 0; }
  .fotos img { width: 100%; object-fit: cover; border-radius: 3mm; background: #eee; }
  .fotos.uma img { height: 108mm; }
  /* Com duas, a primeira manda: ela é a frente do carro, a outra é apoio. */
  .fotos.duas .principal  { height: 108mm; flex: 2; }
  .fotos.duas .secundaria { height: 108mm; flex: 1; }
  .sem-foto {
    height: 108mm; margin: 7mm 0 0; display: flex; align-items: center; justify-content: center;
    border: 1.5pt dashed #bbb; border-radius: 3mm; color: #888; font-size: 13pt;
  }

  /* O preço é o maior elemento da folha de propósito: é o que a pessoa procura
     primeiro, e normalmente de longe. */
  .preco {
    margin-top: auto; padding: 6mm 0 4mm; border-top: 2.5pt solid #111;
    display: flex; align-items: baseline; justify-content: space-between;
  }
  .preco .rotulo { font-size: 12pt; text-transform: uppercase; letter-spacing: 2px; color: #666; }
  .preco strong { font-size: 44pt; line-height: 1; letter-spacing: -1.5px; }

  .specs { display: flex; gap: 3mm; margin-top: 5mm; }
  .spec {
    flex: 1; border: 1pt solid #ddd; border-radius: 2mm; padding: 3mm 3mm 3.5mm; text-align: center;
  }
  .spec span { display: block; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 1px; color: #777; }
  .spec strong { display: block; font-size: 13pt; margin-top: 1.5mm; }

  .rodape {
    margin-top: 5mm; padding-top: 3mm; border-top: 0.75pt solid #ddd;
    display: flex; justify-content: space-between; font-size: 10pt; color: #666;
  }
</style></head><body>${html}</body></html>`);
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
