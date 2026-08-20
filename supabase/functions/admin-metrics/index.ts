// admin-metrics — painel do dono do sistema: consumo, custo e cobrança de todas
// as lojas.
//
// Existe porque o RLS isola cada lojista na própria conta (correto), e por isso
// não há como o administrador enxergar o conjunto por query normal. Em vez de
// abrir buraco no RLS de várias tabelas, esta função confere quem chama e usa
// service_role só aqui dentro.
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

  // Administradores em secret, não no código: trocar quem tem acesso não
  // deveria exigir deploy.
  const admins = (Deno.env.get('ADMIN_EMAILS') ?? '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const email = String(user.email ?? '').toLowerCase();
  if (!admins.length || !admins.includes(email)) {
    console.warn('[admin-metrics] acesso negado para', email);
    return json({ error: 'Acesso restrito a administradores.' }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sem corpo: usa os padrões */ }

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const acao = String(body?.acao ?? 'metricas');

  // ── Marcar ou desmarcar pagamento do mês ───────────────────────────────────
  if (acao === 'marcar_pagamento') {
    const { user_id, competencia, pago, valor } = body as {
      user_id?: string; competencia?: string; pago?: boolean; valor?: number;
    };
    if (!user_id) return json({ error: 'user_id obrigatório' }, 400);
    const { error } = await admin.rpc('admin_marcar_pagamento', {
      p_user_id: user_id,
      p_competencia: competencia ?? new Date().toISOString().slice(0, 10),
      p_pago: pago !== false,
      p_valor: typeof valor === 'number' ? valor : null,
    });
    if (error) return json({ error: `Falha ao registrar pagamento: ${error.message}` }, 500);
    return json({ ok: true });
  }

  // ── Suspender / reativar ───────────────────────────────────────────────────
  if (acao === 'suspender') {
    const { user_id, suspenso, motivo } = body as { user_id?: string; suspenso?: boolean; motivo?: string };
    if (!user_id) return json({ error: 'user_id obrigatório' }, 400);
    const ativar = suspenso === true;
    const { error } = await admin
      .from('company_settings')
      .update({
        suspenso: ativar,
        suspenso_em: ativar ? new Date().toISOString() : null,
        suspenso_motivo: ativar ? (motivo ?? null) : null,
      })
      .eq('user_id', user_id);
    if (error) return json({ error: `Falha ao alterar suspensão: ${error.message}` }, 500);
    console.log(`[admin-metrics] ${ativar ? 'SUSPENDEU' : 'reativou'} ${user_id} (por ${email})`);
    return json({ ok: true });
  }

  // ── Salvar o plano da loja (dia e valor) ───────────────────────────────────
  if (acao === 'salvar_plano') {
    const { user_id, billing_day, billing_amount } = body as {
      user_id?: string; billing_day?: number | null; billing_amount?: number | null;
    };
    if (!user_id) return json({ error: 'user_id obrigatório' }, 400);
    const dia = billing_day == null ? null : Math.min(31, Math.max(1, Math.floor(Number(billing_day))));
    const { error } = await admin
      .from('company_settings')
      .update({ billing_day: dia, billing_amount: billing_amount ?? null })
      .eq('user_id', user_id);
    if (error) return json({ error: `Falha ao salvar plano: ${error.message}` }, 500);
    return json({ ok: true });
  }

  // ── Detalhe de uma loja ────────────────────────────────────────────────────
  if (acao === 'detalhe') {
    const { user_id } = body as { user_id?: string };
    if (!user_id) return json({ error: 'user_id obrigatório' }, 400);

    let d = 30;
    const nd = Number(body?.dias);
    if (Number.isFinite(nd) && nd > 0 && nd <= 365) d = Math.floor(nd);
    const desdeDet = new Date(Date.now() - d * 86400000).toISOString();

    const { data: det, error: detErr } = await admin.rpc('admin_detalhe_loja', {
      p_user_id: user_id, p_desde: desdeDet,
    });
    if (detErr) return json({ error: `Falha ao carregar detalhe: ${detErr.message}` }, 500);

    // Qualidade do número direto na Meta. NÃO pode derrubar a tela: se a Meta
    // estiver fora, ou o token da loja vencido, o resto do detalhe continua
    // valendo — por isso vai em try isolado e devolve null.
    let whatsapp: unknown = null;
    try {
      const { data: cfg } = await admin
        .from('company_settings')
        .select('whatsapp_business_account_id')
        .eq('user_id', user_id)
        .maybeSingle();
      const waba = String(cfg?.whatsapp_business_account_id ?? '');
      if (waba) {
        const { data: tok } = await admin.rpc('get_whatsapp_token', { p_user_id: user_id });
        const token = String(tok ?? '') || (Deno.env.get('WHATSAPP_TOKEN') ?? '');
        if (token) {
          const r = await fetch(
            `https://graph.facebook.com/v20.0/${waba}/phone_numbers` +
            '?fields=display_phone_number,verified_name,quality_rating,status,messaging_limit_tier',
            { headers: { Authorization: `Bearer ${token}` } },
          );
          const j = await r.json();
          whatsapp = r.ok ? (j?.data?.[0] ?? null) : { erro: j?.error?.message ?? `HTTP ${r.status}` };
        }
      }
    } catch (e) {
      console.warn('[admin-metrics] qualidade Meta indisponível:', (e as Error)?.message);
    }

    return json({ dias: d, detalhe: det, whatsapp });
  }

  // ── Métricas (padrão) ──────────────────────────────────────────────────────
  let dias = 30;
  const d = Number(body?.dias);
  if (Number.isFinite(d) && d > 0 && d <= 365) dias = Math.floor(d);

  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const { data, error } = await admin.rpc('admin_metricas', { p_desde: desde });
  if (error) {
    console.error('[admin-metrics] rpc erro:', error.message);
    return json({ error: `Falha ao consultar métricas: ${error.message}` }, 500);
  }

  type Loja = { custo_total_usd: number; conversas_bot: number; tokens_total: number; billing_amount: number | null; pago_mes_atual: boolean };
  const lojas = (data ?? []) as Loja[];
  const soma = (f: (l: Loja) => number) => lojas.reduce((s, l) => s + Number(f(l) ?? 0), 0);

  const custoUsd  = soma((l) => l.custo_total_usd);
  const conversas = soma((l) => l.conversas_bot);

  return json({
    dias,
    desde,
    lojas,
    total: {
      lojas: lojas.length,
      custo_usd: Number(custoUsd.toFixed(4)),
      conversas,
      tokens: soma((l) => l.tokens_total),
      // Média do conjunto, não média das médias — esta última distorce a favor
      // de loja pequena.
      custo_por_conversa_usd: conversas ? Number((custoUsd / conversas).toFixed(4)) : 0,
      receita_mes: soma((l) => (l.billing_amount ?? 0)),
      recebido_mes: lojas.reduce((s, l) => s + (l.pago_mes_atual ? Number(l.billing_amount ?? 0) : 0), 0),
    },
  });
});
