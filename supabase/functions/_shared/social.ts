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

const GRAPH = 'https://graph.facebook.com/v20.0';

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
    if (msg.is_echo === true) return null; // resposta da própria página

    const de = String((evento.sender as Record<string, string>)?.id ?? '');
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

    if (!texto && !anexoUrl) return null;

    return { canal, contaId, de, texto, mid: String(msg.mid ?? ''), anexoUrl };
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
): Promise<{ ok: boolean; erro?: string }> {
  if (!contaId || !para || !token) {
    return { ok: false, erro: 'contaId, destinatário e token são obrigatórios' };
  }

  const res = await fetch(`${GRAPH}/${contaId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      recipient: { id: para },
      message: { text: texto },
      // RESPONSE mantém a janela de 24h. Sem a tag, mensagem fora da janela é
      // recusada — e é o caso mais comum quando o cliente demora a voltar.
      messaging_type: 'RESPONSE',
    }),
  });

  if (!res.ok) {
    const corpo = await res.text();
    return { ok: false, erro: `HTTP ${res.status}: ${corpo.slice(0, 300)}` };
  }
  return { ok: true };
}

/** Envia uma imagem por URL. */
export async function enviarImagemSocial(
  contaId: string,
  para: string,
  url: string,
  token: string,
): Promise<{ ok: boolean; erro?: string }> {
  const res = await fetch(`${GRAPH}/${contaId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      recipient: { id: para },
      message: { attachment: { type: 'image', payload: { url, is_reusable: true } } },
      messaging_type: 'RESPONSE',
    }),
  });
  if (!res.ok) {
    const corpo = await res.text();
    return { ok: false, erro: `HTTP ${res.status}: ${corpo.slice(0, 300)}` };
  }
  return { ok: true };
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
): Promise<string> {
  try {
    const res = await fetch(`${GRAPH}/${psid}?fields=name,username`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return '';
    const j = await res.json() as { name?: string; username?: string };
    return String(j?.name ?? j?.username ?? '').trim();
  } catch {
    return '';
  }
}
