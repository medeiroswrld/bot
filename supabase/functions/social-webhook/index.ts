// social-webhook — recebe Instagram Direct e Messenger.
//
// Função SEPARADA do whatsapp-webhook de propósito. O webhook do WhatsApp é o
// caminho mais crítico do sistema e já caiu uma vez este mês; misturar dois
// formatos de payload nele multiplicaria a chance de repetir. Aqui, um erro no
// Instagram não encosta no WhatsApp.
//
// Mesma app da Meta, mesmo app secret — só muda o produto e a URL de callback.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parseSocial, nomeDoUsuarioSocial } from '../_shared/social.ts';

const ok  = () => new Response('EVENT_RECEIVED', { status: 200 });
const err = (s: number, m: string) => new Response(m, { status: s });

const initAdmin = () => createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function computeHmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a[i] ^ b[i];
  return dif === 0;
}

serve(async (req) => {
  const url = new URL(req.url);

  // ── GET: verificação do webhook pela Meta ──────────────────────────────────
  if (req.method === 'GET') {
    const modo = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    // Token próprio, com o do WhatsApp como reserva. Separado de propósito: o
    // do WhatsApp já está em uso e ninguém lembra o valor (a Meta não mostra
    // depois de salvo), então trocá-lo arriscaria a verificação de um canal
    // que está funcionando.
    const esperado = Deno.env.get('SOCIAL_VERIFY_TOKEN')
      || Deno.env.get('WHATSAPP_VERIFY_TOKEN')
      || '';
    if (modo === 'subscribe' && token === esperado && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return err(403, 'Forbidden');
  }

  if (req.method !== 'POST') return err(405, 'Method Not Allowed');

  const rawBody = await req.text();

  // ── Assinatura HMAC ────────────────────────────────────────────────────────
  // Aceita mais de um segredo: o app do Instagram tem chave secreta PRÓPRIA,
  // separada da do app do Facebook. Qual deles assina depende de como o canal
  // foi configurado, e conferir só um recusaria tudo — com 401 e sem pista.
  const segredos = [
    Deno.env.get('INSTAGRAM_APP_SECRET') ?? '',
    Deno.env.get('WHATSAPP_APP_SECRET') ?? '',
  ].filter(Boolean);

  if (!segredos.length) {
    console.error('[SW] nenhum app secret configurado');
    return err(500, 'Webhook não configurado');
  }

  const sig = req.headers.get('x-hub-signature-256') ?? '';
  const recebida = new TextEncoder().encode(sig);
  let confere = false;
  for (const seg of segredos) {
    const esp = new TextEncoder().encode('sha256=' + (await computeHmac(seg, rawBody)));
    if (recebida.length === esp.length && timingSafeEqual(recebida, esp)) { confere = true; break; }
  }
  if (!confere) {
    // Diz quantos segredos foram testados: "inválida" com um segredo só e
    // "inválida" com dois são diagnósticos diferentes.
    console.warn(`[SW] assinatura inválida (testados ${segredos.length} segredo(s))`);
    return err(401, 'Unauthorized');
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return ok(); }

  const msg = parseSocial(payload);
  // Sempre 200: evento que não interessa (curtida, entrega, eco da própria
  // página) não é erro. Devolver outra coisa faria a Meta reenviar em loop e,
  // repetindo, desativar o webhook.
  if (!msg) return ok();

  const supabase = initAdmin();

  // ── Qual loja? ─────────────────────────────────────────────────────────────
  // O Instagram chega com o ID da conta IG; o Messenger, com o ID da página.
  const coluna = msg.canal === 'instagram' ? 'ig_user_id' : 'fb_page_id';
  const { data: cfg, error: cfgErr } = await supabase
    .from('company_settings')
    .select('user_id')
    .eq(coluna, msg.contaId)
    .maybeSingle();

  if (cfgErr) {
    // Erro de consulta NÃO é o mesmo que conta não cadastrada — foi confundir
    // os dois que derrubou o webhook do WhatsApp em 20/08.
    console.error('[SW] falha ao resolver a loja:', cfgErr.message);
    return ok();
  }
  if (!cfg?.user_id) {
    console.warn(`[SW] ${coluna} não cadastrado: ${msg.contaId}`);
    return ok();
  }
  const userId = cfg.user_id;

  // ── Deduplicação pelo mid ──────────────────────────────────────────────────
  // A Meta reenvia quando não recebe 200 a tempo. Sem isso o bot responde duas
  // vezes à mesma mensagem.
  if (msg.mid) {
    const { data: jaExiste } = await supabase
      .from('messages')
      .select('id')
      .eq('wa_message_id', msg.mid)
      .maybeSingle();
    if (jaExiste) return ok();
  }

  // ── Conversa ───────────────────────────────────────────────────────────────
  // customer_phone guarda o PSID/IGSID nestes canais (ver comentário da 056).
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, status, customer_name')
    .eq('user_id', userId)
    .eq('channel', msg.canal)
    .eq('customer_phone', msg.de)
    .maybeSingle();

  const agora = new Date().toISOString();
  let convId = conv?.id as string | undefined;

  if (!convId) {
    // Nome só na criação: uma consulta por mensagem seria desperdício, e o nome
    // não muda.
    let nome = '';
    try {
      const { data: tok } = await supabase.rpc('get_meta_page_token', { p_user_id: userId, p_canal: msg.canal });
      if (tok) nome = await nomeDoUsuarioSocial(msg.de, String(tok));
    } catch (e) {
      console.warn('[SW] não consegui o nome do usuário:', (e as Error)?.message);
    }

    const { data: nova, error: novaErr } = await supabase
      .from('conversations')
      .insert({
        user_id: userId,
        channel: msg.canal,
        customer_phone: msg.de,
        customer_name: nome || null,
        status: 'bot',
        last_message_at: agora,
      })
      .select('id')
      .single();
    if (novaErr || !nova) {
      console.error('[SW] falha ao criar conversa:', novaErr?.message);
      return ok();
    }
    convId = nova.id;
  }

  // ── Salva a mensagem ───────────────────────────────────────────────────────
  // Foto vira o mesmo formato dos outros canais ([imagem] url), pro CRM
  // renderizar igual. A URL da Meta expira, então isso é provisório até a
  // cópia pro Storage — que fica para a próxima etapa.
  const conteudo = msg.anexoUrl
    ? `[imagem] ${msg.anexoUrl}${msg.texto ? `\n${msg.texto}` : ''}`
    : msg.texto;

  const { error: msgErr } = await supabase.from('messages').insert({
    conversation_id: convId,
    role: 'customer',
    content: conteudo,
    wa_message_id: msg.mid || null,
  });
  if (msgErr) {
    console.error('[SW] falha ao salvar mensagem:', msgErr.message);
    return ok();
  }

  await supabase.from('conversations')
    .update({ last_message_at: agora })
    .eq('id', convId);

  // ── Acorda o bot ───────────────────────────────────────────────────────────
  if (conv?.status !== 'human') {
    fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-conversation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ conversation_id: convId }),
    }).catch((e) => console.error('[SW] falha ao acordar o bot:', e));
  }

  console.log(`[SW] ${msg.canal}: mensagem recebida (conversa ${convId})`);
  return ok();
});
