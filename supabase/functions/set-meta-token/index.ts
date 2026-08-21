// set-meta-token — guarda o token da página (Instagram/Messenger) no Vault.
//
// Espelha a set-whatsapp-token: o token nunca passa por tabela comum nem volta
// para o navegador. Token de página permite responder como a marca, então tem
// o mesmo peso do token do WhatsApp.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders as CORS } from '../_shared/cors.ts';

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'Method Not Allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authorization ausente' }, 401);

  const url        = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey    = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  // Quem é o chamador vem do JWT, nunca do corpo.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: 'Não autenticado' }, 401);

  let body: { token?: string; remove?: boolean; canal?: string };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const remove = body?.remove === true;
  const token  = typeof body?.token === 'string' ? body.token.trim() : '';
  const canal  = String(body?.canal ?? '').toLowerCase();

  // Canal explicito e obrigatorio: sem ele o token iria pro lugar errado e o
  // sintoma seria "conectei o Instagram e o bot nao responde", sem erro nenhum.
  if (canal !== 'instagram' && canal !== 'messenger') {
    return json({ error: 'canal deve ser instagram ou messenger' }, 400);
  }

  if (!remove) {
    if (!token)            return json({ error: 'Token vazio.' }, 400);
    if (token.length < 20) return json({ error: 'Token muito curto — confira se colou o token completo.' }, 400);
    if (/\s/.test(token))  return json({ error: 'Token não pode conter espaços.' }, 400);
  }

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: rpcErr } = await admin.rpc('set_meta_page_token', {
    p_user_id: user.id,
    p_canal:   canal,
    p_token:   remove ? '' : token,
  });

  if (rpcErr) {
    console.error('[set-meta-token] rpc erro:', rpcErr.message);
    // Devolve o motivo: mensagem genérica aqui vira tentativa e erro, como já
    // aconteceu com o token do WhatsApp.
    let detalhe = String(rpcErr.message ?? '');
    if (token.length >= 20) detalhe = detalhe.replaceAll(token, '[token]');
    return json({ error: `Falha ao salvar o token: ${detalhe}` }, 500);
  }

  return json({ success: true, removed: remove });
});
