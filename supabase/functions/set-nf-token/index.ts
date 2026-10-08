import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildCors } from '../_shared/cors.ts';

// set-nf-token — guarda o token do provedor de NF-e no Vault.
//
// Espelha a set-meta-token, e pelo mesmo motivo: quem tem este token emite
// documento fiscal com validade jurídica em nome da loja. Ele nunca passa por
// tabela comum nem volta para o navegador.

Deno.serve(async (req) => {
  const CORS = buildCors(req);
  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

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

  let body: { token?: string; remove?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const remove = body?.remove === true;
  const token  = typeof body?.token === 'string' ? body.token.trim() : '';

  if (!remove) {
    if (!token)            return json({ error: 'Token vazio.' }, 400);
    if (token.length < 12) return json({ error: 'Token muito curto — confira se colou o token completo.' }, 400);
    if (/\s/.test(token))  return json({ error: 'Token não pode conter espaços.' }, 400);
  }

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.rpc('set_nf_token', {
    p_user_id: user.id,
    p_token:   remove ? '' : token,
  });

  if (error) {
    console.error('[set-nf-token] rpc erro:', error.message);
    // A mensagem volta sem o token dentro, mesmo que o Postgres o tenha
    // ecoado: erro que vaza segredo é pior que erro genérico.
    let detalhe = String(error.message ?? '');
    if (token.length >= 12) detalhe = detalhe.replaceAll(token, '[token]');
    return json({ error: `Falha ao salvar o token: ${detalhe}` }, 500);
  }

  return json({ success: true, removed: remove });
});
