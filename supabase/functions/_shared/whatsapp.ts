// Camada de abstração do WhatsApp.
// Suporta dois providers: 'cloud' (Meta Business Cloud API) e 'evolution' (Evolution API v2).
// Escolha via variável de ambiente WHATSAPP_PROVIDER.

export interface InboundMessage {
  phoneNumberId: string   // Cloud: phone_number_id do metadata; Evolution: nome da instância
  from: string            // Telefone do cliente (formato internacional, ex.: 5515999998888)
  senderName: string      // Nome exibido no WhatsApp
  text: string            // Texto da mensagem
  waMessageId: string     // ID da mensagem no WhatsApp (para deduplicação)
}

// ─── parseInboundMessage ───────────────────────────────────────────────────────

export function parseInboundMessage(payload: unknown): InboundMessage | null {
  const provider = Deno.env.get('WHATSAPP_PROVIDER') ?? 'cloud';
  return provider === 'evolution' ? parseEvolution(payload) : parseCloud(payload);
}

function parseCloud(payload: unknown): InboundMessage | null {
  try {
    const p = payload as Record<string, unknown>;
    if (p.object !== 'whatsapp_business_account') return null;

    const entry  = (p.entry as unknown[])?.[0] as Record<string, unknown>;
    const change = (entry?.changes as unknown[])?.[0] as Record<string, unknown>;
    const value  = change?.value as Record<string, unknown>;
    if (!value || change?.field !== 'messages') return null;

    const messages = value.messages as unknown[];
    if (!messages?.length) return null;

    const msg = messages[0] as Record<string, unknown>;
    if (msg.type !== 'text') return null;

    const metadata = value.metadata as Record<string, string>;
    const contact  = ((value.contacts as unknown[])?.[0] as Record<string, unknown>) ?? {};
    const profile  = (contact.profile as Record<string, string>) ?? {};

    const text = ((msg.text as Record<string, string>)?.body ?? '').trim();
    if (!text) return null;

    return {
      phoneNumberId: metadata?.phone_number_id ?? '',
      from:          String(msg.from ?? ''),
      senderName:    profile.name ?? '',
      text,
      waMessageId:   String(msg.id ?? ''),
    };
  } catch {
    return null;
  }
}

function parseEvolution(payload: unknown): InboundMessage | null {
  try {
    const p    = payload as Record<string, unknown>;
    if (p.event !== 'messages.upsert') return null;

    const data = p.data as Record<string, unknown>;
    const key  = data?.key as Record<string, unknown>;
    if (key?.fromMe === true) return null;

    const message = data?.message as Record<string, unknown>;
    const text = (
      (message?.conversation as string) ??
      (message?.extendedTextMessage as Record<string, string>)?.text ??
      ''
    ).trim();
    if (!text) return null;

    // remoteJid: "5515999998888@s.whatsapp.net" → "5515999998888"
    const from = String(key?.remoteJid ?? '').replace(/@.*$/, '');

    return {
      phoneNumberId: String(p.instance ?? ''),
      from,
      senderName:    String(data?.pushName ?? ''),
      text,
      waMessageId:   String(key?.id ?? ''),
    };
  } catch {
    return null;
  }
}

// ─── sendMessage ──────────────────────────────────────────────────────────────
// Retorna true em sucesso, false em falha.

export async function sendImage(
  to: string,
  imageUrl: string,
  phoneNumberId?: string,
): Promise<boolean> {
  const provider = Deno.env.get('WHATSAPP_PROVIDER') ?? 'cloud';
  const token    = Deno.env.get('WHATSAPP_TOKEN') ?? '';

  if (!token) {
    console.error('[WA] WHATSAPP_TOKEN não configurado');
    return false;
  }

  if (provider !== 'cloud') {
    console.warn('[WA] sendImage disponível apenas para provider cloud');
    return false;
  }

  const pid = phoneNumberId ?? Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
  if (!pid) {
    console.error('[WA Cloud] phone_number_id não fornecido para sendImage');
    return false;
  }

  const res = await fetch(`https://graph.facebook.com/v20.0/${pid}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'image',
      image: { link: imageUrl },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[WA Cloud] Erro ao enviar imagem para ${to}: ${res.status} ${body}`);
    return false;
  }
  return true;
}

export async function sendMessage(
  to: string,
  text: string,
  phoneNumberId?: string,
): Promise<boolean> {
  const provider = Deno.env.get('WHATSAPP_PROVIDER') ?? 'cloud';
  const token    = Deno.env.get('WHATSAPP_TOKEN') ?? '';

  if (!token) {
    console.error('[WA] WHATSAPP_TOKEN não configurado');
    return false;
  }

  return provider === 'evolution'
    ? sendEvolution(to, text, token, phoneNumberId)
    : sendCloud(to, text, token, phoneNumberId);
}

async function sendCloud(
  to: string,
  text: string,
  token: string,
  phoneNumberId?: string,
): Promise<boolean> {
  const pid = phoneNumberId ?? Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
  if (!pid) {
    console.error('[WA Cloud] phone_number_id não fornecido e WHATSAPP_PHONE_NUMBER_ID não configurado');
    return false;
  }

  const res = await fetch(`https://graph.facebook.com/v20.0/${pid}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[WA Cloud] Erro ao enviar para ${to}: ${res.status} ${body}`);
    return false;
  }
  return true;
}

async function sendEvolution(
  to: string,
  text: string,
  token: string,
  instance?: string,
): Promise<boolean> {
  const baseUrl = Deno.env.get('WHATSAPP_EVOLUTION_URL') ?? '';
  const inst    = instance ?? Deno.env.get('WHATSAPP_EVOLUTION_INSTANCE') ?? '';

  if (!baseUrl || !inst) {
    console.error('[WA Evolution] WHATSAPP_EVOLUTION_URL ou instância não configurados');
    return false;
  }

  // Evolution API v2: { number, text }
  const res = await fetch(`${baseUrl}/message/sendText/${inst}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: token,
    },
    body: JSON.stringify({ number: to, text }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[WA Evolution] Erro ao enviar para ${to}: ${res.status} ${body}`);
    return false;
  }
  return true;
}
