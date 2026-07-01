import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { buildCors } from '../_shared/cors.ts';

// Grava/remove o token do WhatsApp do tenant, CIFRADO no Vault (via RPC
// set_whatsapp_token). Autenticada por JWT: o user_id vem SEMPRE do token de
// auth (getUser), nunca do body — um cliente não seta o token de outro. O token
// nunca trafega num PATCH à tabela nem volta na resposta.
serve(async (req) => {
  const CORS = buildCors(req);
  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'Method Not Allowed' }, 405);

  // 1. Exige JWT no header
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authorization ausente' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  // 2. Descobre QUEM é o usuário pelo JWT (valida no auth server). NUNCA confia em user_id do body.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: 'Não autenticado' }, 401);

  // 3. Body: token pra setar OU remove:true pra limpar
  let body: { token?: string; remove?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const remove = body?.remove === true;
  const token  = typeof body?.token === 'string' ? body.token.trim() : '';

  // 4. Validação mínima (só quando setando)
  if (!remove) {
    if (!token)            return json({ error: 'Token vazio.' }, 400);
    if (token.length < 20) return json({ error: 'Token muito curto — confira se colou o token completo.' }, 400);
    if (/\s/.test(token))  return json({ error: 'Token não pode conter espaços.' }, 400);
  }

  // 5. service_role → RPC que cifra no Vault. user_id vem do JWT (user.id).
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: rpcErr } = await admin.rpc('set_whatsapp_token', {
    p_user_id: user.id,
    p_token:   remove ? '' : token,   // vazio → a RPC remove o secret (volta pro fallback global)
  });
  if (rpcErr) {
    console.error('[set-whatsapp-token] rpc erro:', rpcErr.message);
    return json({ error: 'Falha ao salvar o token.' }, 500);
  }

  // 6. Nunca devolve o token
  return json({ success: true, removed: remove });
});
