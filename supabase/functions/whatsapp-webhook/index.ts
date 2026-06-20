import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { timingSafeEqual } from 'https://deno.land/std@0.224.0/crypto/timing_safe_equal.ts';
import { parseInboundMessage, sendMessage } from '../_shared/whatsapp.ts';
import { maskPhone } from '../_shared/maskPII.ts';

// ─── helpers ──────────────────────────────────────────────────────────────────

function ok(body = 'OK'): Response {
  return new Response(body, { status: 200 });
}

function err(status: number, msg: string): Response {
  return new Response(msg, { status });
}

function initAdmin() {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// HMAC-SHA256 usando Web Crypto (disponível em Deno)
async function computeHmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── status updates de campanhas (sent/delivered/read/failed) ──────────────────
// ADICIONAL ao processamento de mensagens — não substitui nada.
// Idempotente: só atualiza/incrementa se o status realmente mudou para aquele wamid.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processStatuses(payload: any): Promise<void> {
  try {
    const entries = payload?.entry ?? [];
    let supabase: ReturnType<typeof initAdmin> | null = null;

    for (const entry of entries) {
      for (const change of (entry?.changes ?? [])) {
        const statuses = change?.value?.statuses;
        if (!Array.isArray(statuses) || statuses.length === 0) continue;

        if (!supabase) supabase = initAdmin();

        for (const status of statuses) {
          const wamid = status?.id;
          const newStatus = status?.status; // sent | delivered | read | failed
          if (!wamid || !newStatus) continue;

          const ts = status?.timestamp
            ? new Date(parseInt(status.timestamp, 10) * 1000).toISOString()
            : new Date().toISOString();

          console.log('[webhook-status]', wamid, '→', newStatus);

          // Busca o envio de campanha por wamid. Se não existir, não é campanha — ignora.
          const { data: existing } = await supabase
            .from('campaign_sends')
            .select('id, status, campaign_id')
            .eq('whatsapp_message_id', wamid)
            .maybeSingle();

          if (!existing) continue;
          // Idempotência: mesmo status já registrado → não incrementa de novo
          if (existing.status === newStatus) {
            console.log('[webhook-status] sem mudança (idempotente):', wamid, newStatus);
            continue;
          }

          const updates: Record<string, unknown> = { status: newStatus };
          if (newStatus === 'sent') updates.sent_at = ts;
          else if (newStatus === 'delivered') updates.delivered_at = ts;
          else if (newStatus === 'read') updates.read_at = ts;
          else if (newStatus === 'failed') {
            updates.failed_at = ts;
            updates.error_message = JSON.stringify(status?.errors ?? {});
          }

          await supabase.from('campaign_sends').update(updates).eq('id', existing.id);

          // Incremento atômico do contador agregado da campanha
          await supabase.rpc('increment_campaign_counter', {
            campaign_id: existing.campaign_id,
            field_name: `${newStatus}_count`,
          });

          console.log('[webhook-status] atualizado', existing.id, existing.status, '→', newStatus);
        }
      }
    }
  } catch (e) {
    console.error('[webhook-status] erro:', e);
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  const url = new URL(req.url);

  // ── GET: verificação inicial do webhook pela Meta ──────────────────────────
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const expected = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';

    if (mode === 'subscribe' && token === expected && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return err(403, 'Forbidden');
  }

  if (req.method !== 'POST') {
    return err(405, 'Method Not Allowed');
  }

  // ── POST: mensagem recebida ─────────────────────────────────────────────────

  // 1. Lê o corpo UMA vez (necessário antes de verificar assinatura)
  const rawBody = await req.text();

  // 2. Verifica assinatura HMAC-SHA256
  // Para o provider 'cloud' (Meta), a verificação é obrigatória.
  // Para 'evolution', a assinatura não existe — pula.
  const provider = Deno.env.get('WHATSAPP_PROVIDER') ?? 'cloud';
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET') ?? '';

  if (provider === 'cloud') {
    if (!appSecret) {
      console.error('[WH] WHATSAPP_APP_SECRET não configurado para provider cloud');
      return err(500, 'Webhook não configurado corretamente');
    }
    const sig = req.headers.get('x-hub-signature-256') ?? '';
    const expected = 'sha256=' + (await computeHmac(appSecret, rawBody));
    // Comparação em tempo constante para evitar timing attacks
    const sigBytes = new TextEncoder().encode(sig);
    const expBytes = new TextEncoder().encode(expected);
    if (sigBytes.length !== expBytes.length || !timingSafeEqual(sigBytes, expBytes)) {
      console.warn('[WH] Assinatura inválida');
      return err(401, 'Unauthorized');
    }
  }

  // 3. Parse do payload
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return ok(); // Payload mal formado — responde 200 para não retentar
  }

  // Processa status updates de campanhas (sent/delivered/read/failed).
  // ADICIONAL: não interfere no fluxo de mensagens abaixo.
  await processStatuses(payload);

  const msg = parseInboundMessage(payload);
  if (!msg) {
    // Não é uma mensagem de texto válida (pode ser status/delivery receipt — já tratado acima)
    return ok();
  }

  const { phoneNumberId, from, senderName, text, waMessageId } = msg;
  const supabase = initAdmin();

  // 4. Deduplicação: verifica se já processamos esta mensagem
  const { data: existing } = await supabase
    .from('messages')
    .select('id')
    .eq('wa_message_id', waMessageId)
    .maybeSingle();

  if (existing) {
    return ok(); // Reenvio do WhatsApp — ignora
  }

  // 5. Resolve a concessionária pelo phone_number_id cadastrado
  const { data: settings } = await supabase
    .from('company_settings')
    .select('user_id')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .maybeSingle();

  if (!settings?.user_id) {
    console.warn(`[WH] phone_number_id não cadastrado: ${phoneNumberId}`);
    return ok();
  }

  const userId = settings.user_id;

  // 6. Acha ou cria a conversa para (user_id, customer_phone)
  const now = new Date().toISOString();

  const { data: upsertedConv, error: convErr } = await supabase
    .from('conversations')
    .upsert(
      {
        user_id: userId,
        customer_phone: from,
        customer_name: senderName || null,
        last_message_at: now,
      },
      { onConflict: 'user_id,customer_phone' },
    )
    .select()
    .single();

  if (convErr || !upsertedConv) {
    console.error('[WH] Erro ao upsert conversa:', convErr);
    return ok();
  }

  // 7. Garante que existe um lead para este contato (cria apenas se não existir)
  const { data: existingLead } = await supabase
    .from('leads')
    .select('id')
    .eq('user_id', userId)
    .eq('phone', from)
    .maybeSingle();

  if (!existingLead) {
    await supabase.from('leads').insert({
      user_id: userId,
      name: senderName || 'Cliente WhatsApp',
      phone: from,
      status: 'novo',
      notes: 'Lead criado automaticamente via WhatsApp',
    });
  }

  // 8. Helper: aciona process-conversation de forma assíncrona (mantém a function viva)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const fireProcess = (conversationId: string) => {
    // @ts-ignore — EdgeRuntime é global nas Supabase Edge Functions
    EdgeRuntime.waitUntil(
      fetch(`${supabaseUrl}/functions/v1/process-conversation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch((e: unknown) => console.error('[WH] Erro ao acionar process-conversation:', e)),
    );
  };

  // 9a. Mensagem de TEXTO — fluxo normal
  if (msg.type === 'text') {
    const { error: msgErr } = await supabase.from('messages').insert({
      conversation_id: upsertedConv.id,
      role: 'customer',
      content: text,
      wa_message_id: waMessageId,
    });
    if (msgErr) {
      console.error('[WH] Erro ao salvar mensagem:', msgErr);
      return ok();
    }
    if (upsertedConv.status !== 'human') fireProcess(upsertedConv.id);
    return ok();
  }

  // 9b. Mensagem de ÁUDIO — claim de dedup + transcrição em background
  if (msg.type === 'audio') {
    // Claim: insere já a mensagem (placeholder) para reservar o wa_message_id e
    // evitar transcrição dupla caso chegue uma entrega duplicada da Meta.
    const { data: audioMsg, error: claimErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: upsertedConv.id,
        role: 'customer',
        content: '🎤 Áudio recebido, transcrevendo…',
        wa_message_id: waMessageId,
        transcribed_from_audio: true,
      })
      .select('id')
      .single();

    if (claimErr || !audioMsg) {
      console.warn('[WH] claim de áudio falhou (duplicado?):', claimErr?.message);
      return ok();
    }

    const convId  = upsertedConv.id;
    const isHuman = upsertedConv.status === 'human';
    const mediaId = msg.mediaId ?? '';
    const pid     = phoneNumberId;

    // @ts-ignore — EdgeRuntime é global nas Supabase Edge Functions
    EdgeRuntime.waitUntil((async () => {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ media_id: mediaId, phone_number_id: pid }),
        });
        const result = await res.json().catch(() => ({ success: false, code: 'openai_error' }));

        if (result?.success && result.text) {
          await supabase.from('messages').update({ content: result.text }).eq('id', audioMsg.id);
          console.log(`[WH-audio] transcrito (${maskPhone(from)}): ${String(result.text).length} chars`);
          if (!isHuman) fireProcess(convId);
          return;
        }

        // Erro de transcrição: registra marcador e responde de forma humana
        const code = String(result?.code ?? 'openai_error');
        console.error(`[WH-audio] falha (${maskPhone(from)}): ${code} ${result?.error ?? ''}`);
        await supabase.from('messages').update({ content: '[áudio com falha de transcrição]' }).eq('id', audioMsg.id);

        const FALLBACKS: Record<string, { msg: string; handoff: boolean }> = {
          too_large:       { msg: 'Recebi seu áudio mas é muito longo pra eu processar. Pode resumir por texto ou mandar em partes?', handoff: false },
          download_failed: { msg: 'Tive um problema técnico, pode mandar de novo?', handoff: true },
          timeout:         { msg: 'Recebi seu áudio mas tive um problema pra processar. Pode me mandar por texto?', handoff: true },
          openai_error:    { msg: 'Recebi seu áudio mas tive um problema pra processar. Pode me mandar por texto?', handoff: true },
        };
        const fb = FALLBACKS[code] ?? FALLBACKS.openai_error;

        const sent = await sendMessage(from, fb.msg, pid || undefined);
        if (!sent) console.error('[WH-audio] falha ao enviar fallback (salvo no banco mesmo assim)');
        await supabase.from('messages').insert({ conversation_id: convId, role: 'bot', content: fb.msg });
        await supabase.from('conversations').update({
          last_message_at: new Date().toISOString(),
          ...(fb.handoff ? { status: 'pending' } : {}),
        }).eq('id', convId);
      } catch (e) {
        console.error('[WH-audio] exceção no processamento de áudio:', e);
      }
    })());

    return ok();
  }

  return ok(); // tipo não suportado
});
