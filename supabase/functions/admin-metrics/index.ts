// admin-metrics — visão do dono do sistema sobre todas as lojas.
//
// Existe porque o RLS isola cada lojista da própria conta (correto), e por isso
// não há como o administrador enxergar o conjunto pela query normal. Em vez de
// abrir buraco no RLS de várias tabelas, esta função confere quem chama e usa
// service_role só aqui.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authorization ausente' }, 401);

  const url        = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey    = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  // Quem é o chamador — validado no auth server, nunca confiando no corpo.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: 'Não autenticado' }, 401);

  // Lista de administradores em secret, não no código: trocar quem tem acesso
  // não deveria exigir deploy.
  const admins = (Deno.env.get('ADMIN_EMAILS') ?? '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const email = String(user.email ?? '').toLowerCase();
  if (!admins.length || !admins.includes(email)) {
    console.warn('[admin-metrics] acesso negado para', email);
    return json({ error: 'Acesso restrito' }, 403);
  }

  let dias = 30;
  try {
    const body = await req.json();
    const d = Number(body?.dias);
    if (Number.isFinite(d) && d > 0 && d <= 365) dias = Math.floor(d);
  } catch {
    // sem corpo: usa o padrão de 30 dias
  }

  const desde = new Date(Date.now() - dias * 86400000).toISOString();

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await admin.rpc('admin_metricas', { p_desde: desde });
  if (error) {
    console.error('[admin-metrics] rpc erro:', error.message);
    return json({ error: `Falha ao consultar métricas: ${error.message}` }, 500);
  }

  const lojas = data ?? [];
  const totalUsd = lojas.reduce((s: number, l: { custo_total_usd: number }) => s + Number(l.custo_total_usd ?? 0), 0);
  const totalConversas = lojas.reduce((s: number, l: { conversas_bot: number }) => s + Number(l.conversas_bot ?? 0), 0);

  return json({
    dias,
    desde,
    lojas,
    total: {
      custo_usd: Number(totalUsd.toFixed(4)),
      conversas: totalConversas,
      // Custo médio do conjunto — não é a média das médias, que distorceria a
      // favor de loja pequena.
      custo_por_conversa_usd: totalConversas ? Number((totalUsd / totalConversas).toFixed(4)) : 0,
    },
  });
});
