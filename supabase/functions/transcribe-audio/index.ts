import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { buildCors } from '../_shared/cors.ts';
import { resolveWhatsAppToken } from '../_shared/whatsapp.ts';

const WHISPER_TIMEOUT_MS = 30000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB — limite do Whisper

function extFromMime(mime: string): string {
  if (mime.includes('ogg'))  return 'ogg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('mp4')  || mime.includes('m4a')) return 'm4a';
  if (mime.includes('wav'))  return 'wav';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('amr'))  return 'amr';
  return 'ogg';
}

serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  let body: { media_id?: string; phone_number_id?: string; user_id?: string };
  try { body = await req.json(); } catch { return json({ success: false, code: 'bad_request', error: 'JSON inválido' }, 400); }

  const mediaId = String(body.media_id ?? '').trim();
  const phoneNumberId = String(body.phone_number_id ?? '');
  const userId = String(body.user_id ?? '') || null;
  if (!mediaId) return json({ success: false, code: 'bad_request', error: 'media_id obrigatório' }, 400);

  // Token do tenant (com fallback global) — o áudio está sob a WABA do dono da conversa.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const waToken   = await resolveWhatsAppToken(supabase, userId);
  const openaiKey = Deno.env.get('OPENAI_API_KEY') ?? '';
  if (!waToken)   return json({ success: false, code: 'download_failed', error: 'WHATSAPP_TOKEN ausente' });
  if (!openaiKey) return json({ success: false, code: 'openai_error',   error: 'OPENAI_API_KEY ausente' });

  const logCtx = `media=${mediaId.slice(0, 6)}… pid=${phoneNumberId ? '***' + phoneNumberId.slice(-4) : '-'}`;

  // 1. URL temporária do áudio (Graph API)
  let mediaUrl = '';
  let mimeType = 'audio/ogg';
  let reportedSize = 0;
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${waToken}` },
    });
    if (!metaRes.ok) {
      console.error(`[transcribe] meta GET ${metaRes.status} (${logCtx})`);
      return json({ success: false, code: 'download_failed', error: `graph ${metaRes.status}` });
    }
    const meta = await metaRes.json();
    mediaUrl = String(meta?.url ?? '');
    mimeType = String(meta?.mime_type ?? 'audio/ogg');
    reportedSize = Number(meta?.file_size ?? 0);
    if (!mediaUrl) return json({ success: false, code: 'download_failed', error: 'sem url' });
  } catch (e) {
    console.error(`[transcribe] erro GET media (${logCtx}):`, e);
    return json({ success: false, code: 'download_failed', error: 'falha consultar media' });
  }

  if (reportedSize > MAX_AUDIO_BYTES) {
    console.warn(`[transcribe] grande ${reportedSize}B (${logCtx})`);
    return json({ success: false, code: 'too_large', error: '>25MB' });
  }

  // 2. Baixa o áudio (precisa do Bearer também)
  let audioBuf: ArrayBuffer;
  try {
    const dl = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${waToken}` } });
    if (!dl.ok) {
      console.error(`[transcribe] download ${dl.status} (${logCtx})`);
      return json({ success: false, code: 'download_failed', error: `download ${dl.status}` });
    }
    audioBuf = await dl.arrayBuffer();
  } catch (e) {
    console.error(`[transcribe] erro download (${logCtx}):`, e);
    return json({ success: false, code: 'download_failed', error: 'falha baixar' });
  }

  if (audioBuf.byteLength > MAX_AUDIO_BYTES) {
    console.warn(`[transcribe] baixado ${audioBuf.byteLength}B (${logCtx})`);
    return json({ success: false, code: 'too_large', error: '>25MB' });
  }

  // 3. Whisper (OpenAI), timeout de 30s
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WHISPER_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append('file', new Blob([audioBuf], { type: mimeType }), `audio.${extFromMime(mimeType)}`);
    form.append('model', 'whisper-1');
    form.append('language', 'pt');

    const wres = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
      signal: controller.signal,
    });
    if (!wres.ok) {
      const t = await wres.text();
      console.error(`[transcribe] whisper ${wres.status} (${logCtx}): ${t.slice(0, 200)}`);
      return json({ success: false, code: 'openai_error', error: `whisper ${wres.status}` });
    }
    const data = await wres.json();
    const text = String(data?.text ?? '').trim();
    if (!text) return json({ success: false, code: 'openai_error', error: 'transcrição vazia' });

    console.log(`[transcribe] OK (${logCtx}): ${text.length} chars`);
    return json({ success: true, text });
  } catch (e) {
    const isTimeout = (e as Error)?.name === 'AbortError';
    console.error(`[transcribe] ${isTimeout ? 'timeout' : 'erro'} whisper (${logCtx}):`, e);
    return json({ success: false, code: isTimeout ? 'timeout' : 'openai_error', error: isTimeout ? 'timeout 30s' : 'erro whisper' });
  } finally {
    clearTimeout(timeout);
  }
});
