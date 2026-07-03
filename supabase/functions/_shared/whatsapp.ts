// Camada de abstração do WhatsApp.
// Suporta dois providers: 'cloud' (Meta Business Cloud API) e 'evolution' (Evolution API v2).
// Escolha via variável de ambiente WHATSAPP_PROVIDER.

import { logger, type Logger } from './logger.ts';

export interface InboundMessage {
  phoneNumberId: string   // Cloud: phone_number_id do metadata; Evolution: nome da instância
  from: string            // Telefone do cliente (formato internacional, ex.: 5515999998888)
  senderName: string      // Nome exibido no WhatsApp
  text: string            // Texto da mensagem (vazio quando type === 'audio', preenchido após transcrição)
  waMessageId: string     // ID da mensagem no WhatsApp (para deduplicação)
  type: 'text' | 'audio'  // Tipo da mensagem recebida
  mediaId?: string        // ID da mídia na Meta (presente quando type === 'audio')
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

    const metadata = value.metadata as Record<string, string>;
    const contact  = ((value.contacts as unknown[])?.[0] as Record<string, unknown>) ?? {};
    const profile  = (contact.profile as Record<string, string>) ?? {};
    const base = {
      phoneNumberId: metadata?.phone_number_id ?? '',
      from:          String(msg.from ?? ''),
      senderName:    profile.name ?? '',
      waMessageId:   String(msg.id ?? ''),
    };

    if (msg.type === 'text') {
      const text = ((msg.text as Record<string, string>)?.body ?? '').trim();
      if (!text) return null;
      return { ...base, text, type: 'text' };
    }

    if (msg.type === 'audio') {
      const mediaId = String((msg.audio as Record<string, string>)?.id ?? '');
      if (!mediaId) return null;
      return { ...base, text: '', type: 'audio', mediaId };
    }

    return null; // imagem, vídeo, documento, etc. — não suportados
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
      type:          'text', // Evolution: áudio não suportado neste escopo (produção usa 'cloud')
    };
  } catch {
    return null;
  }
}

// ─── token por tenant ──────────────────────────────────────────────────────────
// Resolve o token do tenant (decifrado do Vault via get_whatsapp_token) com
// FALLBACK pro WHATSAPP_TOKEN global. Tenant sem token próprio (ex.: cliente
// atual) continua no token global — nada quebra. Falha no RPC → global também.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveWhatsAppToken(supabase: any, userId?: string | null): Promise<string> {
  const globalToken = Deno.env.get('WHATSAPP_TOKEN') ?? '';
  if (!userId || !supabase) return globalToken;
  try {
    const { data, error } = await supabase.rpc('get_whatsapp_token', { p_user_id: userId });
    if (error) {
      logger.warn('get_whatsapp_token → fallback global', { action: 'resolveWhatsAppToken', error: error.message });
      return globalToken;
    }
    const tenantToken = String(data ?? '').trim();
    return tenantToken || globalToken;
  } catch (e) {
    logger.warn('get_whatsapp_token exceção → fallback global', { action: 'resolveWhatsAppToken', error: e });
    return globalToken;
  }
}

// ─── sendMessage ──────────────────────────────────────────────────────────────
// Retorna true em sucesso, false em falha.

export async function sendImage(
  to: string,
  imageUrl: string,
  phoneNumberId?: string,
  token?: string,
  log?: Logger,
): Promise<boolean> {
  const l = log ?? logger;
  const provider = Deno.env.get('WHATSAPP_PROVIDER') ?? 'cloud';
  const tk       = (token ?? Deno.env.get('WHATSAPP_TOKEN') ?? '').trim();

  if (!tk) { l.error('token ausente', { action: 'sendImage' }); return false; }
  if (provider !== 'cloud') { l.warn('sendImage só no provider cloud', { action: 'sendImage' }); return false; }

  const pid = phoneNumberId ?? Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
  if (!pid) { l.error('phone_number_id ausente', { action: 'sendImage' }); return false; }

  const res = await fetch(`https://graph.facebook.com/v20.0/${pid}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tk}`,
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
    l.error('falha ao enviar imagem', { action: 'sendImage', to, status: res.status, body });
    return false;
  }
  return true;
}

export async function sendVideo(
  to: string,
  videoUrl: string,
  phoneNumberId?: string,
  caption?: string,
  token?: string,
  log?: Logger,
): Promise<boolean> {
  const l = log ?? logger;
  const provider = Deno.env.get('WHATSAPP_PROVIDER') ?? 'cloud';
  const tk       = (token ?? Deno.env.get('WHATSAPP_TOKEN') ?? '').trim();

  if (!tk) { l.error('token ausente', { action: 'sendVideo' }); return false; }
  if (provider !== 'cloud') { l.warn('sendVideo só no provider cloud', { action: 'sendVideo' }); return false; }

  const pid = phoneNumberId ?? Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
  if (!pid) { l.error('phone_number_id ausente', { action: 'sendVideo' }); return false; }

  const res = await fetch(`https://graph.facebook.com/v25.0/${pid}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tk}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'video',
      video: { link: videoUrl, ...(caption ? { caption } : {}) },
    }),
  });

  const result = await res.text();
  l.debug('sendVideo resposta', { action: 'sendVideo', status: res.status });

  if (!res.ok) {
    l.error('falha ao enviar vídeo', { action: 'sendVideo', to, status: res.status, result });
    return false;
  }
  return true;
}

export async function sendMessage(
  to: string,
  text: string,
  phoneNumberId?: string,
  token?: string,
  log?: Logger,
): Promise<boolean> {
  const l = log ?? logger;
  const provider = Deno.env.get('WHATSAPP_PROVIDER') ?? 'cloud';
  const tk       = (token ?? Deno.env.get('WHATSAPP_TOKEN') ?? '').trim();

  if (!tk) { l.error('token ausente', { action: 'sendMessage' }); return false; }

  return provider === 'evolution'
    ? sendEvolution(to, text, tk, phoneNumberId, l)
    : sendCloud(to, text, tk, phoneNumberId, l);
}

async function sendCloud(
  to: string,
  text: string,
  token: string,
  phoneNumberId?: string,
  log?: Logger,
): Promise<boolean> {
  const l = log ?? logger;
  const pid = phoneNumberId ?? Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
  if (!pid) { l.error('phone_number_id ausente', { action: 'sendCloud' }); return false; }

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
    l.error('falha ao enviar', { action: 'sendCloud', to, status: res.status, body });
    return false;
  }
  return true;
}

async function sendEvolution(
  to: string,
  text: string,
  token: string,
  instance?: string,
  log?: Logger,
): Promise<boolean> {
  const l = log ?? logger;
  const baseUrl = Deno.env.get('WHATSAPP_EVOLUTION_URL') ?? '';
  const inst    = instance ?? Deno.env.get('WHATSAPP_EVOLUTION_INSTANCE') ?? '';

  if (!baseUrl || !inst) { l.error('Evolution URL/instância não configurados', { action: 'sendEvolution' }); return false; }

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
    l.error('falha ao enviar', { action: 'sendEvolution', to, status: res.status, body });
    return false;
  }
  return true;
}
