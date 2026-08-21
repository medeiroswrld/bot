// Envio e leitura de Instagram Direct e Messenger.
//
// Separado de whatsapp.ts de propósito: são APIs diferentes (endpoint, formato
// do destinatário, token) e o arquivo do WhatsApp é o caminho mais crítico do
// sistema. Misturar os dois aumentaria a chance de uma mudança no Instagram
// quebrar o WhatsApp.
//
// Diferenças que importam:
//  - o destinatário é um PSID/IGSID, não um telefone — e ele é escopado à
//    página: o mesmo usuário tem IDs diferentes em páginas diferentes;
//  - o token é o da PÁGINA, não o da WABA;
//  - o endpoint de envio é o do remetente (page id / ig user id), com o
//    destinatário no corpo.

// Dois hosts, e qual vale depende de COMO o canal foi conectado:
//  - Instagram com login do Instagram  -> graph.instagram.com
//  - Instagram com login do Facebook   -> graph.facebook.com
//  - Messenger (sempre pela página)    -> graph.facebook.com
//
// Como o CRM atende várias lojas e cada uma pode ter sido conectada de um
// jeito, tenta o host provável primeiro e cai no outro se falhar. O custo é uma
// chamada extra só quando a primeira dá errado — bem melhor que exigir que o
// lojista saiba qual fluxo usou.
const HOST_IG = 'https://graph.instagram.com/v21.0';
const HOST_FB = 'https://graph.facebook.com/v20.0';

const hostsPara = (canal: CanalSocial): string[] =>
  canal === 'instagram' ? [HOST_IG, HOST_FB] : [HOST_FB];

export type CanalSocial = 'instagram' | 'messenger';

export type MensagemSocial = {
  canal: CanalSocial;
  /** ID da página (messenger) ou da conta IG — é por ele que se acha a loja. */
  contaId: string;
  /** PSID/IGSID de quem escreveu. */
  de: string;
  texto: string;
  mid: string;
  /** Anexo (foto) quando houver — a URL da Meta expira, então é copiada depois. */
  anexoUrl?: string;
  /** Resposta a story: a imagem do story que o cliente estava vendo. */
  storyUrl?: string;
  /** ID do story respondido — é por ele que se pede a miniatura, quando é vídeo. */
  storyId?: string;
  /** true = a própria loja escreveu, pelo app do celular (coexistência). */
  isEco?: boolean;
};

/**
 * Lê o webhook do Instagram/Messenger.
 *
 * O eco da própria página chega no MESMO array `messaging`, marcado com
 * `is_echo`. Sem descartar, o bot responderia à própria mensagem em laço.
 */
export function parseSocial(payload: unknown): MensagemSocial | null {
  try {
    const p = payload as Record<string, unknown>;
    const objeto = String(p?.object ?? '');
    if (objeto !== 'instagram' && objeto !== 'page') return null;
    const canal: CanalSocial = objeto === 'instagram' ? 'instagram' : 'messenger';

    const entry = (p.entry as unknown[])?.[0] as Record<string, unknown>;
    if (!entry) return null;
    const contaId = String(entry.id ?? '');

    const evento = (entry.messaging as unknown[])?.[0] as Record<string, unknown>;
    if (!evento) return null;

    const msg = evento.message as Record<string, unknown> | undefined;
    if (!msg) return null;                 // curtida, leitura, entrega: não é mensagem

    // Eco = a própria loja respondeu pelo app do celular. Descartar aqui (o que
    // eu fazia antes) evita o bot responder a si mesmo, mas custa caro: a
    // resposta do vendedor não entra no CRM e o bot continua atendendo por cima
    // dele. É o mesmo problema que o smb_message_echoes resolveu no WhatsApp.
    const isEco = msg.is_echo === true;

    // Nos papéis: no eco quem interessa é o DESTINATÁRIO (o cliente); na
    // mensagem normal, o remetente.
    const remetente = String((evento.sender as Record<string, string>)?.id ?? '');
    const destino   = String((evento.recipient as Record<string, string>)?.id ?? '');
    const de = isEco ? destino : remetente;
    if (!de || de === contaId) return null;

    const texto = String(msg.text ?? '').trim();

    // Primeiro anexo de imagem, quando houver. Story reply e figurinha também
    // chegam como attachment, e por ora só a imagem é aproveitada.
    let anexoUrl: string | undefined;
    const anexos = msg.attachments as Array<Record<string, unknown>> | undefined;
    const img = anexos?.find((a) => a?.type === 'image');
    if (img) {
      const payloadAnexo = img.payload as Record<string, string> | undefined;
      if (payloadAnexo?.url) anexoUrl = payloadAnexo.url;
    }

    // Resposta a STORY. Vem com a referência ao story respondido, e a imagem
    // dele é justamente o carro que o cliente está vendo. Sem isso o bot recebe
    // só "quanto?" e não tem como saber de qual veículo — que é a pergunta mais
    // comum vinda de story.
    let storyUrl: string | undefined;
    const respostaA = msg.reply_to as Record<string, unknown> | undefined;
    const story = respostaA?.story as Record<string, string> | undefined;
    let storyId: string | undefined;
    if (story?.url) storyUrl = story.url;
    if (story?.id) storyId = String(story.id);

    if (!texto && !anexoUrl && !storyUrl) return null;

    return { canal, contaId, de, texto, mid: String(msg.mid ?? ''), anexoUrl, storyUrl, storyId, isEco };
  } catch {
    return null;
  }
}

/**
 * Envia texto pelo Instagram ou Messenger.
 *
 * Os dois usam o mesmo formato de corpo; o que muda é o ID do remetente na URL.
 * Devolve ok + erro legível: falha silenciosa aqui significa cliente sem
 * resposta e ninguém sabendo.
 */
export async function enviarSocial(
  contaId: string,
  para: string,
  texto: string,
  token: string,
  canal: CanalSocial = 'instagram',
): Promise<{ ok: boolean; erro?: string; mid?: string }> {
  if (!contaId || !para || !token) {
    return { ok: false, erro: 'contaId, destinatário e token são obrigatórios' };
  }

  const corpo = JSON.stringify({
    recipient: { id: para },
    message: { text: texto },
    // RESPONSE mantém a janela de 24h. Sem a tag, mensagem fora da janela é
    // recusada — e é o caso mais comum quando o cliente demora a voltar.
    messaging_type: 'RESPONSE',
  });

  let ultimoErro = '';
  for (const host of hostsPara(canal)) {
    const res = await fetch(`${host}/${contaId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: corpo,
    });
    if (res.ok) {
      // Guarda o message_id: e ele que permite reconhecer, la no webhook, que
      // o eco que voltou e da NOSSA propria mensagem. Sem isso o bot marca a
      // si mesmo como atendente e a conversa vai pra 'humano' — o bot se cala
      // depois de cada resposta.
      const j = await res.json().catch(() => ({})) as { message_id?: string };
      return { ok: true, mid: j?.message_id };
    }
    ultimoErro = `HTTP ${res.status} em ${host}: ${(await res.text()).slice(0, 250)}`;
  }
  return { ok: false, erro: ultimoErro };
}

/**
 * Miniatura de um story em vídeo.
 *
 * O webhook manda a URL do VÍDEO, que o modelo não lê. Mas o objeto do story
 * tem thumbnail_url — um quadro em JPEG, que é exatamente o que aparece na
 * conversa quando alguém responde um story em vídeo. Com ela o bot volta a
 * enxergar o carro.
 */
export async function miniaturaDoStory(
  storyId: string,
  token: string,
  canal: CanalSocial = 'instagram',
): Promise<string> {
  for (const host of hostsPara(canal)) {
    try {
      const res = await fetch(`${host}/${storyId}?fields=media_type,media_url,thumbnail_url`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;
      const j = await res.json() as { media_type?: string; media_url?: string; thumbnail_url?: string };
      // thumbnail_url só existe em vídeo; em foto o próprio media_url serve.
      const url = j?.thumbnail_url || (j?.media_type === 'IMAGE' ? j?.media_url : '');
      if (url) return String(url);
    } catch {
      // host errado ou story expirado: tenta o próximo e desiste em silêncio.
    }
  }
  return '';
}

/** Envia uma imagem por URL. */
export async function enviarImagemSocial(
  contaId: string,
  para: string,
  url: string,
  token: string,
  canal: CanalSocial = 'instagram',
): Promise<{ ok: boolean; erro?: string }> {
  const corpo = JSON.stringify({
    recipient: { id: para },
    message: { attachment: { type: 'image', payload: { url, is_reusable: true } } },
    messaging_type: 'RESPONSE',
  });

  let ultimoErro = '';
  for (const host of hostsPara(canal)) {
    const res = await fetch(`${host}/${contaId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: corpo,
    });
    if (res.ok) return { ok: true };
    ultimoErro = `HTTP ${res.status} em ${host}: ${(await res.text()).slice(0, 250)}`;
  }
  return { ok: false, erro: ultimoErro };
}

/**
 * Nome de quem escreveu. Instagram e Messenger não mandam o nome no webhook —
 * só o ID — então precisa de uma consulta à parte. Sem isso a conversa apareceu
 * no CRM identificada por um número gigante.
 *
 * Falha aqui não é fatal: melhor conversa sem nome do que mensagem perdida.
 */
export async function nomeDoUsuarioSocial(
  psid: string,
  token: string,
  canal: CanalSocial = 'instagram',
): Promise<string> {
  for (const host of hostsPara(canal)) {
    try {
      const res = await fetch(`${host}/${psid}?fields=name,username`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;
      const j = await res.json() as { name?: string; username?: string };
      const nome = String(j?.name ?? j?.username ?? '').trim();
      if (nome) return nome;
    } catch {
      // host errado ou perfil sem nome público: tenta o próximo e, no fim,
      // devolve vazio. Conversa sem nome é melhor que mensagem perdida.
    }
  }
  return '';
}
