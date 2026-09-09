// Preparo de imagem antes do upload.
//
// O motivo é o iPhone. Desde 2017 ele fotografa em HEIC por padrão, e o lojista
// não faz ideia disso — ele só tira foto do carro e manda. O arquivo chega e
// nada funciona:
//
//   • Chrome, Firefox e Edge não sabem exibir HEIC (só o Safari sabe)
//   • a Cloud API do WhatsApp aceita jpeg e png, não heic — então o bot não
//     conseguiria enviar a foto pro cliente
//   • o site da loja, que lê o feed público, mostraria imagem quebrada
//
// A conversão acontece aqui, no navegador, ANTES de subir. Assim tudo daqui pra
// frente continua sendo JPEG e nenhuma outra parte do sistema precisa saber que
// HEIC existe.

// Lado maior máximo. Foto de iPhone moderno passa de 4000px e 10 MB — tamanho
// que só serve pra estourar o limite de upload, deixar o site lento e demorar
// pra enviar no WhatsApp. 2000px é mais do que qualquer anúncio de carro usa.
const LADO_MAXIMO = 2000;
const QUALIDADE = 0.85;

/** É HEIC/HEIF? */
export const ehHeic = (file) => {
  const nome = String(file?.name ?? '').toLowerCase();
  const tipo = String(file?.type ?? '').toLowerCase();
  // A extensão entra na checagem porque vários navegadores entregam o arquivo
  // do iPhone com `type` VAZIO. Confiar só no mime deixaria passar direto.
  return tipo.includes('heic') || tipo.includes('heif')
    || nome.endsWith('.heic') || nome.endsWith('.heif');
};

/** Desenha num canvas respeitando o lado máximo e devolve JPEG. */
const redimensionar = (blob, nomeBase) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const escala = Math.min(1, LADO_MAXIMO / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(img.width  * escala);
    canvas.height = Math.round(img.height * escala);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(
      (out) => out
        ? resolve(new File([out], nomeBase, { type: 'image/jpeg' }))
        : reject(new Error('não consegui gerar o JPEG')),
      'image/jpeg',
      QUALIDADE,
    );
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('não consegui ler a imagem')); };
  img.src = url;
});

/**
 * Devolve um arquivo pronto pra subir.
 *
 * HEIC vira JPEG; qualquer outro formato passa intacto — converter um JPEG que
 * já está bom só perderia qualidade e tempo.
 *
 * A biblioteca é carregada sob demanda: são mais de 1 MB de WebAssembly, e não
 * faz sentido todo mundo baixar isso pra cadastrar uma foto que veio do Android.
 */
export const prepararImagem = async (file) => {
  if (!file || !ehHeic(file)) return file;

  const { default: heic2any } = await import('heic2any');
  const convertido = await heic2any({ blob: file, toType: 'image/jpeg', quality: QUALIDADE });
  // Com várias imagens dentro (Live Photo), devolve array.
  const blob = Array.isArray(convertido) ? convertido[0] : convertido;

  const nomeBase = String(file.name ?? 'foto').replace(/\.(heic|heif)$/i, '') + '.jpg';

  try {
    return await redimensionar(blob, nomeBase);
  } catch {
    // Se o redimensionamento falhar, o JPEG convertido já resolve o problema
    // principal. Melhor uma foto grande do que nenhuma.
    return new File([blob], nomeBase, { type: 'image/jpeg' });
  }
};
