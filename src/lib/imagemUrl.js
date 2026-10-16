// Miniaturas de verdade, em vez do arquivo original.
//
// ── O problema que isto resolve ────────────────────────────────────────────
//
// As fotos de carro são guardadas como vêm do celular do lojista: média de
// 2,6 MB cada, 816 arquivos. E eram servidas assim em TODO lugar — inclusive
// numa grade de miniaturas de 200px.
//
// A conta da tela de estoque, medida: 29 carros × 2 MB = ~58 MB antes de
// aparecer qualquer coisa. Era essa a lentidão.
//
// ── Como funciona ─────────────────────────────────────────────────────────
//
// O Storage do Supabase serve a mesma imagem redimensionada trocando
// `/object/public/` por `/render/image/public/` e passando a largura. Medido
// neste projeto, na mesma foto:
//
//     original          2.044.572 bytes
//     width=400 q=70      109.392 bytes     ← 19x menor
//
// ── Por que transformar na HORA DE EXIBIR, e não no banco ─────────────────
//
// A URL gravada em `car_images.image_url` continua apontando para o original.
// Isso é de propósito: o original é o que o bot manda pro cliente e o que o
// visualizador em tela cheia mostra. Reescrever o banco destruiria a única
// cópia boa, e seria irreversível.
//
// Aqui a transformação é só uma leitura diferente do mesmo arquivo.

/** Larguras que a interface usa. Nomear evita número solto espalhado pelo código. */
export const LARGURA = {
  miniatura: 200,   // grade de vendidos, linha de thumbs
  cartao:    600,   // card do estoque
  grande:   1400,   // visualizador — ainda bem menor que o original
};

/**
 * Devolve a URL da imagem redimensionada.
 *
 * Qualquer coisa que não seja uma URL de objeto público do Storage volta
 * intacta: `blob:` de pré-visualização antes do upload, URL externa, nulo.
 * Falhar aqui significaria imagem quebrada na tela, então o padrão é não mexer
 * no que não se reconhece.
 */
export function imagemRedimensionada(url, largura = LARGURA.cartao, qualidade = 70) {
  if (typeof url !== 'string' || !url) return url;
  if (!url.includes('/storage/v1/object/public/')) return url;

  const base = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  const sep = base.includes('?') ? '&' : '?';
  // `resize=contain` NAO e opcional.
  //
  // So com `width`, o Storage espreme a largura e MANTEM a altura original:
  // uma foto 3024x3024 virava 600x3024. Toda foto do estoque ficou esmagada,
  // e o mesmo saiu para o cliente pelo WhatsApp.
  //
  // Com `contain` ele respeita a proporcao — e de quebra o arquivo fica menor
  // (50 KB contra 163 KB na mesma foto), porque nao carrega mais 3024 linhas
  // de altura a toa.
  return `${base}${sep}width=${largura}&resize=contain&quality=${qualidade}`;
}

/** Atalhos, para o chamador não precisar lembrar dos números. */
export const miniatura = (url) => imagemRedimensionada(url, LARGURA.miniatura);
export const cartao    = (url) => imagemRedimensionada(url, LARGURA.cartao);
export const grande    = (url) => imagemRedimensionada(url, LARGURA.grande);
