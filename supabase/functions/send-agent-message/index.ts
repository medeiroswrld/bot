import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { sendMessage, resolveWhatsAppToken } from '../_shared/whatsapp.ts';
import { buildCors } from '../_shared/cors.ts';
import { maskPhone } from '../_shared/maskPII.ts';

serve(async (req) => {
  const CORS = buildCors(req);
  const jsonResponse = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405);
  }

  // ── autenticação via JWT do usuário logado ─────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Authorization header ausente' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  // Cliente com JWT do usuário — respeita RLS para validar propriedade
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Cliente admin — para leitura de company_settings e envio ao WhatsApp
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: { conversation_id?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }

  const { conversation_id, text } = body;

  if (!conversation_id || !text?.trim()) {
    return jsonResponse({ error: 'conversation_id e text são obrigatórios' }, 400);
  }

  // ── valida que o usuário é dono da conversa (via RLS) ──────────────────────
  const { data: conv, error: convErr } = await userClient
    .from('conversations')
    .select('id, user_id, customer_phone, status')
    .eq('id', conversation_id)
    .single();

  if (convErr || !conv) {
    return jsonResponse({ error: 'Conversa não encontrada' }, 404);
  }

  const now = new Date().toISOString();

  // ── salva mensagem com role = 'agent' ──────────────────────────────────────
  const { data: msg, error: msgErr } = await userClient
    .from('messages')
    .insert({ conversation_id, role: 'agent', content: text.trim() })
    .select()
    .single();

  if (msgErr) {
    console.error('[SAM] Erro ao salvar mensagem:', msgErr);
    return jsonResponse({ error: 'Erro ao salvar mensagem' }, 500);
  }

  // ── atualiza last_message_at ───────────────────────────────────────────────
  await adminClient
    .from('conversations')
    .update({ last_message_at: now })
    .eq('id', conversation_id);

  // ── envia ao cliente pelo WhatsApp ─────────────────────────────────────────
  const { data: settings } = await adminClient
    .from('company_settings')
    .select('whatsapp_phone_number_id')
    .eq('user_id', conv.user_id)
    .single();

  const phoneNumberId = String(settings?.whatsapp_phone_number_id ?? '');
  const token = await resolveWhatsAppToken(adminClient, conv.user_id);

  const sent = await sendMessage(conv.customer_phone as string, text.trim(), phoneNumberId || undefined, token);
  if (!sent) {
    console.error(`[SAM] Falha ao enviar WhatsApp para ${maskPhone(conv.customer_phone as string)} — mensagem salva no banco`);
  }

  return jsonResponse({ success: true, message_id: msg.id });
});
