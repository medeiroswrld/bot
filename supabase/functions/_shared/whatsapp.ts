// Camada de abstração do WhatsApp.
// Suporta dois providers: 'cloud' (Meta Business Cloud API) e 'evolution' (Evolution API v2).
// Escolha via variável de ambiente WHATSAPP_PROVIDER.

import { logger, type Logger } from './logger.ts';

/**
 * Bloco que a Meta anexa quando o cliente chegou tocando num anúncio.
 *
 * Só vem na PRIMEIRA mensagem daquela pessoa, e não existe endpoint pra buscar
 * depois. Ou é lido aqui, ou o clique some — junto com qualquer chance de
 * dizer pra Meta que ele virou venda.
 */
export interface AdReferral {
  ctwaClid?: string       // identificador do clique — é o que amarra venda ao anúncio
  sourceId?: string       // id do anúncio
  sourceType?: string     // 'ad' ou 'post'
  sourceUrl?: string
  headline?: string       // título do anúncio
  body?: string           // texto do anúncio
  mediaType?: string      // 'image' ou 'video'
  imageUrl?: string
  videoUrl?: string
  thumbnailUrl?: string
}

export interface InboundMessage {
  phoneNumberId: string   // Cloud: phone_number_id do metadata; Evolution: nome da instância
  from: string            // Telefone do cliente (formato internacional, ex.: 5515999998888)
  senderName: string      // Nome exibido no WhatsApp
  text: string            // Texto da mensagem (vazio quando type === 'audio', preenchido após transcrição)
  waMessageId: string     // ID da mensagem no WhatsApp (para deduplicação)
  type: 'text' | 'audio' | 'image'  // Tipo da mensagem recebida
  mediaId?: string        // ID da mídia na Meta (presente em 'audio' e 'image')
  isEcho?: boolean        // Mensagem que a LOJA enviou pelo celular (coexistência)
  referral?: AdReferral   // Presente só quando veio de anúncio, e só na 1ª mensagem
}

// ─── parseInboundMessage ───────────────────────────────────────────────────────

/**
 * As duas formas do mesmo celular brasileiro: com e sem o nono dígito.
 *
 * A Meta devolve celular antigo como 551596311510 enquanto a planilha do
 * lojista (e o nosso cadastro) tem 5515996311510. É a MESMA pessoa. Casando
 * telefone literal, a resposta do cliente cairia numa conversa nova, separada
 * do disparo que a gerou — e o bot atenderia sem saber o que foi prometido.
 *
 * Só mexe em número BR (55 + DDD): qualquer outro volta como está.
 */
export function variantesTelefoneBR(phone: string): string[] {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (!d.startsWith('55') || d.length < 12 || d.length > 13) return [d].filter(Boolean);

  const ddd = d.slice(2, 4);
  const num = d.slice(4);
  const set = new Set<string>([d]);

  if (num.length === 9 && num.startsWith('9')) set.add(`55${ddd}${num.slice(1)}`);
  if (num.length === 8) set.add(`55${ddd}9${num}`);

  return [...set];
}

export function parseInboundMessage(payload: unknown): InboundMessage | null {
  const provider = Deno.env.get('WHATSAPP_PROVIDER') ?? 'cloud';
  return provider === 'evolution' ? parseEvolution(payload) : parseCloud(payload);
}

/**
 * Traduz o `referral` cru da Meta.
 *
 * Devolve undefined quando não há nada de útil: mensagem normal não tem o
 * bloco, e responder a um story também gera `referral` — mas sem `ctwa_clid` e
 * sem `source_id`, que é o que interessa. Gravar essas seria encher a tabela de
 * linha vazia e depois ter que filtrar em todo relatório.
 */
function lerReferral(cru: unknown): AdReferral | undefined {
  if (!cru || typeof cru !== 'object') return undefined;
  const r = cru as Record<string, unknown>;

  const txt = (v: unknown) => {
    const s = String(v ?? '').trim();
    return s ? s : undefined;
  };

  const ref: AdReferral = {
    ctwaClid:     txt(r.ctwa_clid),
    sourceId:     txt(r.source_id),
    sourceType:   txt(r.source_type),
    sourceUrl:    txt(r.source_url),
    headline:     txt(r.headline),
    body:         txt(r.body),
    mediaType:    txt(r.media_type),
    imageUrl:     txt(r.image_url),
    videoUrl:     txt(r.video_url),
    thumbnailUrl: txt(r.thumbnail_url),
  };

  return (ref.ctwaClid || ref.sourceId) ? ref : undefined;
}

function parseCloud(payload: unknown): InboundMessage | null {
  try {
    const p = payload as Record<string, unknown>;
    if (p.object !== 'whatsapp_business_account') return null;

    const entry  = (p.entry as unknown[])?.[0] as Record<string, unknown>;
    const change = (entry?.changes as unknown[])?.[0] as Record<string, unknown>;
    const value  = change?.value as Record<string, unknown>;
    if (!value) return null;
    if (change?.field !== 'messages' && change?.field !== 'smb_message_echoes') return null;

    // ── Coexistência: mensagem que o LOJISTA mandou pelo celular ──────────
    //    Chega em outro campo (smb_message_echoes) e com os papéis INVERTIDOS:
    //    `from` é a loja e `to` é o cliente. Mapeamos `to` para `from` pra que
    //    toda a resolução de conversa a seguir funcione sem alteração — senão a
    //    conversa seria aberta com o número da própria loja como cliente.
    if (change?.field === 'smb_message_echoes') {
      const meta = value.metadata as Record<string, string>;
      const echo = (value.message_echoes as unknown[])?.[0] as Record<string, unknown>;
      if (!echo) return null;
      const baseEco = {
        phoneNumberId: meta?.phone_number_id ?? '',
        from:          String(echo.to ?? ''),      // o CLIENTE
        senderName:    '',
        waMessageId:   String(echo.id ?? ''),
        isEcho:        true,
      };

      // Foto e áudio que o lojista manda pelo celular. Antes caíam no
      // `return null` e sumiam: o time abria a conversa e via o cliente
      // perguntar seguido de nada, sem saber que o vendedor já tinha
      // respondido com a foto do carro.
      if (echo.type === 'image') {
        const img = echo.image as Record<string, string> | undefined;
        const mediaId = String(img?.id ?? '');
        if (!mediaId) return null;
        return { ...baseEco, text: String(img?.caption ?? '').trim(), type: 'image', mediaId };
      }

      if (echo.type === 'audio') {
        const mediaId = String((echo.audio as Record<string, string>)?.id ?? '');
        if (!mediaId) return null;
        return { ...baseEco, text: '', type: 'audio', mediaId };
      }

      const texto = ((echo.text as Record<string, string>)?.body ?? '').trim();
      if (!texto) return null;   // vídeo, documento e figurinha seguem de fora
      return { ...baseEco, text: texto, type: 'text' };
    }

    const messages = value.messages as unknown[];
    if (!messages?.length) return null;

    const msg = messages[0] as Record<string, unknown>;

    const metadata = value.metadata as Record<string, string>;
    const contact  = ((value.contacts as unknown[])?.[0] as Record<string, unknown>) ?? {};
    const profile  = (contact.profile as Record<string, string>) ?? {};
    // Fica no `base`, e não dentro do ramo de texto, porque quem vem de anúncio
    // nem sempre começa escrevendo: manda a foto do carro da troca, ou toca no
    // botão do template. Ler só no caso de texto perderia justamente o lead mais
    // quente.
    const referral = lerReferral(msg.referral);

    const base = {
      phoneNumberId: metadata?.phone_number_id ?? '',
      from:          String(msg.from ?? ''),
      senderName:    profile.name ?? '',
      waMessageId:   String(msg.id ?? ''),
      ...(referral ? { referral } : {}),
    };

    if (msg.type === 'text') {
      const text = ((msg.text as Record<string, string>)?.body ?? '').trim();
      if (!text) return null;
      return { ...base, text, type: 'text' };
    }

    // Foto que o cliente manda. Antes caía no `return null` lá embaixo: a
    // mensagem não existia, não aparecia no CRM e o bot não respondia NADA -
    // vácuo justamente para quem está no momento mais quente da conversa
    // (fotografando o carro da troca, ou perguntando "vocês têm esse?").
    // A legenda vem junto porque o cliente quase sempre escreve algo com a foto.
    if (msg.type === 'image') {
      const img = msg.image as Record<string, string> | undefined;
      const mediaId = String(img?.id ?? '');
      if (!mediaId) return null;
      return { ...base, text: String(img?.caption ?? '').trim(), type: 'image', mediaId };
    }

    if (msg.type === 'audio') {
      const mediaId = String((msg.audio as Record<string, string>)?.id ?? '');
      if (!mediaId) return null;
      return { ...base, text: '', type: 'audio', mediaId };
    }

    // Resposta em BOTÃO — de template (quick reply) ou de menu interativo.
    // Chega com type próprio e sem `text`, então caía no return null abaixo: o
    // webhook descartava, não gravava mensagem e não acordava o bot. Efeito
    // prático: quem respondia o disparo tocando no botão ficava sem resposta.
    // Vira 'text' de propósito — o resto do fluxo segue igual.
    if (msg.type === 'button') {
      const texto = String((msg.button as Record<string, string>)?.text ?? '').trim();
      if (!texto) return null;
      return { ...base, text: texto, type: 'text' };
    }

    if (msg.type === 'interactive') {
      const inter = msg.interactive as Record<string, Record<string, string>>;

      // Formulário do anúncio (WhatsApp Flows).
      //
      // Chega como `nfm_reply` e caía no return null lá embaixo — ou seja, a
      // mensagem sumia. Isso é grave num anúncio: o modelo padrão de
      // Click-to-WhatsApp da Meta É um formulário, e a PRIMEIRA mensagem é a
      // que carrega o `ctwa_clid`. Descartar ela perdia a conversa inteira e a
      // origem junto, sem erro em lugar nenhum.
      if (inter?.nfm_reply) {
        const bruto = (inter.nfm_reply as unknown as Record<string, string>)?.response_json ?? '';
        let respostas: string[] = [];
        try {
          const obj = JSON.parse(String(bruto)) as Record<string, unknown>;
          respostas = Object.entries(obj)
            // flow_token é controle da Meta, não resposta de ninguém.
            .filter(([k]) => k !== 'flow_token')
            .map(([, v]) => String(v ?? '').trim())
            .filter(Boolean);
        } catch { /* sem json utilizável: cai no texto padrão abaixo */ }

        // Formulário vazio (o caso do anúncio sem campos) não deixa a conversa
        // começar muda. "Vim pelo anúncio" é verdade — a pessoa tocou no
        // anúncio — e dá ao bot um gancho pra abrir sem inventar interesse por
        // um carro que ela não citou.
        const texto = respostas.length ? respostas.join(' — ') : 'Vim pelo anúncio';
        return { ...base, text: texto, type: 'text' };
      }

      const texto = String(
        inter?.button_reply?.title ?? inter?.list_reply?.title ?? '',
      ).trim();
      if (!texto) return null;
      return { ...base, text: texto, type: 'text' };
    }

    return null; // vídeo, documento, sticker, etc. — não suportados
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
  const { ok } = await sendMessageComId(to, text, phoneNumberId, token, log);
  return ok;
}

/**
 * Igual ao sendMessage, mas devolve o `wamid` que a Meta atribuiu à mensagem.
 *
 * É esse id que os webhooks de status (sent/delivered/read) referenciam — sem
 * guardá-lo não há como saber se o cliente leu. Fica numa função separada pra
 * não mexer na assinatura do sendMessage, usado em outras dez funções.
 */
export async function sendMessageComId(
  to: string,
  text: string,
  phoneNumberId?: string,
  token?: string,
  log?: Logger,
): Promise<{ ok: boolean; wamid: string | null }> {
  const l = log ?? logger;
  const provider = Deno.env.get('WHATSAPP_PROVIDER') ?? 'cloud';
  const tk       = (token ?? Deno.env.get('WHATSAPP_TOKEN') ?? '').trim();

  if (!tk) { l.error('token ausente', { action: 'sendMessage' }); return { ok: false, wamid: null }; }

  if (provider === 'evolution') {
    const ok = await sendEvolution(to, text, tk, phoneNumberId, l);
    return { ok, wamid: null };   // Evolution não expõe wamid
  }
  return sendCloud(to, text, tk, phoneNumberId, l);
}

async function sendCloud(
  to: string,
  text: string,
  token: string,
  phoneNumberId?: string,
  log?: Logger,
): Promise<{ ok: boolean; wamid: string | null }> {
  const l = log ?? logger;
  const pid = phoneNumberId ?? Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
  if (!pid) { l.error('phone_number_id ausente', { action: 'sendCloud' }); return { ok: false, wamid: null }; }

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
    return { ok: false, wamid: null };
  }

  // A resposta traz messages[0].id — o wamid que os webhooks de status usam.
  let wamid: string | null = null;
  try {
    const j = await res.json() as { messages?: Array<{ id?: string }> };
    wamid = j?.messages?.[0]?.id ?? null;
  } catch {
    // Enviou, mas não conseguimos ler o id: segue sem rastreio de leitura.
    l.warn('resposta do envio sem wamid legível', { action: 'sendCloud', to });
  }
  return { ok: true, wamid };
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
