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
  // Plano da loja: com ou sem bot. So o administrador altera — a coluna e
  // protegida por trigger no banco, entao nem adianta o lojista tentar pela API.
  if (acao === 'plano') {
    const { user_id, bot_contratado, disparos_contratado } = body as { user_id?: string; bot_contratado?: boolean; disparos_contratado?: boolean };
    if (!user_id) return json({ error: 'user_id obrigatório' }, 400);
    const { error } = await admin
      .from('company_settings')
      .update({
        // So mexe no que veio no corpo: os dois niveis sao independentes e um
        // toggle nao pode zerar o outro sem querer.
        ...(bot_contratado !== undefined ? { bot_contratado: bot_contratado === true } : {}),
        ...(disparos_contratado !== undefined ? { disparos_contratado: disparos_contratado === true } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user_id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // ── Integração de anúncios (CAPI) ──────────────────────────────────────────
  // Dataset e liga/desliga. Protegidos por trigger no banco junto com o plano:
  // se a loja pudesse escolher o dataset, apontaria as conversões pro dataset
  // de terceiro. Quem gerencia o anúncio é quem define isto.
  if (acao === 'capi') {
    const { user_id, capi_dataset_id, capi_enabled } = body as {
      user_id?: string; capi_dataset_id?: string | null; capi_enabled?: boolean;
    };
    if (!user_id) return json({ error: 'user_id obrigatório' }, 400);

    const dataset = capi_dataset_id === undefined
      ? undefined
      : (String(capi_dataset_id ?? '').trim() || null);

    // Ligar sem dataset não faz nada além de encher a fila de evento que nunca
    // sai. Melhor recusar do que deixar o administrador achando que ligou.
    if (capi_enabled === true && dataset === null) {
      return json({ error: 'Informe o dataset antes de ligar a integração.' }, 400);
    }

    const { error } = await admin
      .from('company_settings')
      .update({
        ...(dataset !== undefined ? { capi_dataset_id: dataset } : {}),
        ...(capi_enabled !== undefined ? { capi_enabled: capi_enabled === true } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user_id);

    if (error) return json({ error: error.message }, 500);
    console.log(`[admin-metrics] CAPI de ${user_id} atualizado (por ${email})`);
    return json({ ok: true });
  }

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

  // ── Remover a verificação em duas etapas de uma loja ───────────────────────
  //
  // O caminho de volta pra quem perdeu o celular. O Supabase NÃO gera códigos
  // de recuperação, e desligar o 2FA pela tela exige uma sessão aal2 — ou seja,
  // exige justamente o aplicativo que a pessoa perdeu. Sem esta ação, um lojista
  // que troca de telefone fica trancado pra fora da própria conta e só sai de lá
  // com alguém editando o banco à mão.
  //
  // Fica no painel do administrador de propósito: é a única parte do fluxo onde
  // existe verificação de identidade de verdade — você conhece o cliente.
  if (acao === 'remover_2fa') {
    const { user_id } = body as { user_id?: string };
    if (!user_id) return json({ error: 'user_id obrigatório' }, 400);

    const { data: lista, error: erroLista } =
      await admin.auth.admin.mfa.listFactors({ userId: user_id });
    if (erroLista) return json({ error: `Falha ao listar fatores: ${erroLista.message}` }, 500);

    const fatores = lista?.factors ?? [];
    if (!fatores.length) return json({ ok: true, removidos: 0, mensagem: 'Esta conta não tem verificação em duas etapas ativa.' });

    for (const f of fatores) {
      const { error } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: user_id });
      if (error) return json({ error: `Falha ao remover: ${error.message}` }, 500);
    }

    // Log com quem autorizou: remover 2FA é derrubar uma proteção, e isso
    // precisa deixar rastro.
    console.warn(`[admin-metrics] REMOVEU 2FA de ${user_id} (${fatores.length} fator(es), por ${email})`);
    return json({ ok: true, removidos: fatores.length });
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

  // ── Saldo de creditos por plataforma ───────────────────────────────────────
  if (acao === 'creditos') {
    const { data, error } = await admin.rpc('admin_creditos');
    if (error) return json({ error: `Falha ao ler créditos: ${error.message}` }, 500);
    const { data: precos } = await admin
      .from('model_pricing')
      .select('prefixo, plataforma, entrada_usd, saida_usd, cache_write_usd, cache_read_usd')
      .order('plataforma');
    return json({ creditos: data ?? [], precos: precos ?? [] });
  }

  // Registrar o saldo conferido no site do provedor. E a partir DESTA data que
  // o consumo passa a ser descontado — por isso registrado_em e sempre now(),
  // nunca a data antiga.
  if (acao === 'salvar_credito') {
    const { plataforma, saldo_usd } = body as { plataforma?: string; saldo_usd?: number };
    if (!plataforma) return json({ error: 'plataforma obrigatória' }, 400);
    const { error } = await admin
      .from('platform_credits')
      .upsert({
        plataforma,
        saldo_usd: Number(saldo_usd ?? 0),
        registrado_em: new Date().toISOString(),
      }, { onConflict: 'plataforma' });
    if (error) return json({ error: `Falha ao salvar saldo: ${error.message}` }, 500);
    return json({ ok: true });
  }

  if (acao === 'salvar_preco') {
    const { prefixo, plataforma, entrada_usd, saida_usd, cache_write_usd, cache_read_usd } = body as Record<string, unknown>;
    if (!prefixo) return json({ error: 'prefixo obrigatório' }, 400);
    const { error } = await admin
      .from('model_pricing')
      .upsert({
        prefixo: String(prefixo),
        plataforma: String(plataforma ?? 'outro'),
        entrada_usd: Number(entrada_usd ?? 0),
        saida_usd: Number(saida_usd ?? 0),
        cache_write_usd: Number(cache_write_usd ?? 0),
        cache_read_usd: Number(cache_read_usd ?? 0),
        atualizado_em: new Date().toISOString(),
      }, { onConflict: 'prefixo' });
    if (error) return json({ error: `Falha ao salvar preço: ${error.message}` }, 500);
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

    // Instagram NAO tem nota de qualidade — a Meta nao expoe nada equivalente ao
    // quality_rating do WhatsApp. O que da pra mostrar e se a conexao continua
    // de pe: token valido e perfil respondendo. Quando o token cai, e aqui que
    // aparece, em vez de a loja descobrir por mensagem nao respondida.
    let instagram: unknown = null;
    try {
      const { data: cfgIg } = await admin
        .from('company_settings')
        .select('ig_user_id')
        .eq('user_id', user_id)
        .maybeSingle();
      const ig = String(cfgIg?.ig_user_id ?? '');
      if (ig) {
        const { data: tokIg } = await admin.rpc('get_meta_page_token', {
          p_user_id: user_id, p_canal: 'instagram',
        });
        const tokenIg = String(tokIg ?? '');
        if (!tokenIg) {
          instagram = { erro: 'sem token salvo' };
        } else {
          // Conta ligada por Instagram Login responde em graph.instagram.com;
          // por Facebook Login, em graph.facebook.com. Tenta os dois — o mesmo
          // motivo pelo qual `_shared/social.ts` tem `hostsPara()`.
          for (const host of ['graph.instagram.com', 'graph.facebook.com']) {
            try {
              const r = await fetch(
                `https://${host}/v20.0/${ig}?fields=id,username,account_type,media_count`,
                { headers: { Authorization: `Bearer ${tokenIg}` } },
              );
              const j = await r.json();
              if (r.ok && j?.id) { instagram = j; break; }
              instagram = { erro: j?.error?.message ?? `HTTP ${r.status}` };
            } catch (e) {
              instagram = { erro: (e as Error)?.message ?? 'falha de rede' };
            }
          }
        }
      }
    } catch (e) {
      console.warn('[admin-metrics] perfil do Instagram indisponivel:', (e as Error)?.message);
    }

    return json({ dias: d, detalhe: det, whatsapp, instagram });
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

  // Qualidade do numero em CADA linha, pra dar pra bater o olho na lista e ver
  // qual esta degradado sem abrir loja por loja.
  //
  // Duas garantias aqui: cada consulta vai isolada (Meta fora do ar ou token
  // vencido de UMA loja nao pode derrubar o painel), e o total e limitado —
  // hoje sao poucas contas, mas isto e uma chamada externa por loja e nao pode
  // virar espera de minutos quando forem cinquenta.
  const qualidades = new Map<string, unknown>();
  try {
    const { data: cfgs } = await admin
      .from('company_settings')
      .select('user_id, whatsapp_business_account_id')
      .not('whatsapp_business_account_id', 'is', null)
      .limit(25);

    await Promise.allSettled((cfgs ?? []).map(async (c) => {
      const uid  = String(c.user_id ?? '');
      const waba = String(c.whatsapp_business_account_id ?? '');
      if (!uid || !waba) return;
      const { data: tok } = await admin.rpc('get_whatsapp_token', { p_user_id: uid });
      const token = String(tok ?? '') || (Deno.env.get('WHATSAPP_TOKEN') ?? '');
      if (!token) return;
      const r = await fetch(
        `https://graph.facebook.com/v20.0/${waba}/phone_numbers` +
        '?fields=display_phone_number,quality_rating,status,messaging_limit_tier',
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const j = await r.json();
      if (r.ok && j?.data?.[0]) qualidades.set(uid, j.data[0]);
    }));
  } catch (e) {
    console.warn('[admin-metrics] qualidades da lista indisponiveis:', (e as Error)?.message);
  }

  // Plano de cada loja. Vem por consulta separada em vez de entrar na funcao
  // SQL: mudar o `returns table` do admin_metricas exige DROP + CREATE, e
  // recriar a funcao de metricas pra carregar um booleano nao se paga.
  const planos = new Map<string, { bot: boolean; disparos: boolean; capiOn: boolean; dataset: string | null }>();
  try {
    const { data: linhas } = await admin
      .from('company_settings').select('user_id, bot_contratado, disparos_contratado, capi_enabled, capi_dataset_id');
    for (const l of linhas ?? []) planos.set(String(l.user_id), {
      bot: l.bot_contratado === true,
      disparos: l.disparos_contratado === true,
      capiOn: l.capi_enabled === true,
      dataset: l.capi_dataset_id ?? null,
    });
  } catch (e) {
    console.warn('[admin-metrics] planos indisponiveis:', (e as Error)?.message);
  }

  const lojasComQualidade = lojas.map((l) => {
    const uid = String((l as unknown as { user_id: string }).user_id);
    return {
      ...l,
      qualidade: qualidades.get(uid) ?? null,
      bot_contratado: planos.get(uid)?.bot ?? true,
      disparos_contratado: planos.get(uid)?.disparos ?? true,
      // Default FALSE, ao contrário do plano: loja sem configuração explícita
      // não deve começar mandando conversão pra dataset nenhum.
      capi_enabled: planos.get(uid)?.capiOn ?? false,
      capi_dataset_id: planos.get(uid)?.dataset ?? null,
    };
  });

  return json({
    dias,
    desde,
    lojas: lojasComQualidade,
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
