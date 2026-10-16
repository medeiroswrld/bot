// A mesma foto, num tamanho que faz sentido mandar pelo WhatsApp.
//
// ── Por que isto existe ───────────────────────────────────────────────────
//
// As fotos de carro são guardadas como saem do celular do lojista: média de
// 2,6 MB. O bot manda de 5 a 7 por veículo, e a Meta baixa CADA uma do nosso
// storage antes de entregar ao cliente.
//
// Medido numa foto real deste projeto:
//
//     original              2.198.365 bytes
//     width=1280 q=80         463.000 bytes     ← 78% menos
//
// ── Por que isso não piora o que o cliente vê ─────────────────────────────
//
// A Meta RECOMPRIME tudo que recebe. O WhatsApp e o Instagram não entregam o
// arquivo original: reprocessam para algo bem menor antes de exibir. Mandar
// 2,2 MB não faz o cliente ver 2,2 MB de qualidade — faz a Meta baixar 2,2 MB
// do nosso storage e jogar fora a maior parte.
//
// 1280 de largura mantém folga acima do que eles entregam de qualquer forma.
//
// ── A regra que mantém isto seguro ────────────────────────────────────────
//
// Transformar SÓ na hora de enviar. A URL gravada em `car_images.image_url` e
// no histórico da conversa (`[foto] <url>`) continua sendo a do original.
//
// Isso não é preciosismo: é com aquela string que o bot sabe que já mandou
// aquela foto nesta conversa. Trocar a URL gravada faria a comparação deixar
// de bater com tudo que já existe, e o bot reenviaria a galeria inteira para
// clientes que já a receberam.

/** Largura de envio. Folgada o bastante para a Meta não ser o gargalo. */
const LARGURA_ENVIO = 1280;
const QUALIDADE = 80;

/**
 * URL redimensionada para envio ao cliente.
 *
 * Qualquer coisa que não seja um objeto público do nosso Storage volta
 * intacta — URL externa, vazia, nula. Falhar aqui significaria o cliente não
 * receber a foto, então o padrão é não mexer no que não se reconhece.
 */
export function paraEnvio(url: string, largura = LARGURA_ENVIO): string {
  if (typeof url !== 'string' || !url) return url;
  if (!url.includes('/storage/v1/object/public/')) return url;

  // Video NAO passa por aqui. O endpoint de transformacao e de imagem: dar um
  // .mp4 para ele devolve erro, e o cliente ficaria sem o video.
  //
  // Hoje nenhum caminho chama esta funcao com video — foto e video sao enviados
  // por ramos diferentes. A trava e para o dia em que alguem unificar os dois
  // sem lembrar disto, que e como esse tipo de defeito costuma nascer.
  if (/\.(mp4|mov|avi|webm|ogg|m4v)(\?|$)/i.test(url)) return url;
  if (url.includes('/object/public/car-videos/')) return url;

  const base = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  const sep = base.includes('?') ? '&' : '?';
  // `resize=contain` NAO e opcional: so com `width`, o Storage espreme a
  // largura e MANTEM a altura original — uma foto 3024x3024 virava 600x3024.
  // Foi o que o cliente recebeu pelo WhatsApp desde ontem.
  return `${base}${sep}width=${largura}&resize=contain&quality=${QUALIDADE}`;
}
