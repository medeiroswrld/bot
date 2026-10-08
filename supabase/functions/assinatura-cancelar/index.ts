// assinatura-cancelar — o lojista encerra a assinatura pela própria tela.
//
// ── Por que isto existe ────────────────────────────────────────────────────
//
// Cobrança recorrente no cartão sem cancelamento no mesmo lugar onde se
// assinou não se sustenta. Antes disto, cancelar era pedir por WhatsApp e
// esperar alguém abrir o painel do Asaas — e enquanto esperava, era cobrado.
//
// ── O que ela NÃO faz: mexer no acesso ─────────────────────────────────────
//
// Ela cancela no Asaas e pronto. Quem muda `assinatura_status` é o webhook,
// quando o `SUBSCRIPTION_DELETED` chegar — o mesmo caminho por onde o acesso
// foi liberado.
//
// Isso não é purismo. Se esta função escrevesse o estado por conta própria,
// existiriam dois donos da mesma verdade, e eles divergiriam no primeiro caso
// em que o Asaas recusasse o cancelamento: a tela diria "cancelada" e o cartão
// continuaria sendo cobrado no mês seguinte. Um dono só.
//
// ── E o acesso que já foi pago ─────────────────────────────────────────────
//
// Continua até o fim do mês pago. Quem paga dia 8 e cancela dia 10 fica com os
// 28 dias restantes — cortar ali seria cobrar um mês e entregar dois dias.
// A regra vive em `assinaturaEmDia` (_shared/botGuards.ts) e depende do MOTIVO
// gravado pelo webhook: cortesia só para quem cancelou, nunca para estorno ou
// chargeback.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

/** Sandbox ou produção, decidido pela PRÓPRIA CHAVE (as de homologação têm `hmlg`). */
function baseDoAsaas(chave: string): string {
  return chave.includes('hmlg')
    ? 'https://api-sandbox.asaas.com/v3'
    : 'https://api.asaas.com/v3';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authorization ausente' }, 401);

    const url        = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const chaveSandbox = Deno.env.get('ASAAS_API_KEY_SANDBOX') ?? '';
    const chave = chaveSandbox || (Deno.env.get('ASAAS_API_KEY') ?? '');
    if (!chave) return json({ error: 'Cobrança não configurada.' }, 501);

    // Quem está pedindo — validado no servidor de auth, nunca vindo do corpo.
    // Sem isto, qualquer um cancelaria a assinatura de outra loja mandando um
    // user_id no JSON.
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: erroUser } = await userClient.auth.getUser();
    if (erroUser || !user) return json({ error: 'Não autenticado' }, 401);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: loja, error: erroLoja } = await admin
      .from('company_settings')
      .select('asaas_subscription_id, assinatura_status')
      .eq('user_id', user.id)
      .maybeSingle();
    if (erroLoja) return json({ error: `Não consegui ler os dados da loja: ${erroLoja.message}` }, 500);

    // Mensagens escritas para o LOJISTA, não para o desenvolvedor — quem lê
    // isto é o dono de uma revenda, não quem escreveu o código.
    if (loja?.assinatura_status === 'isento') {
      return json({
        error: 'Sua mensalidade é combinada direto com a gente e não passa por cartão aqui. '
             + 'Fale com o suporte para encerrar.',
      }, 409);
    }

    const assinatura = String(loja?.asaas_subscription_id ?? '').trim();
    if (!assinatura) {
      return json({
        error: 'Não encontrei uma assinatura ativa no cartão para esta conta. '
             + 'Se você acha que isso está errado, fale com o suporte antes de tentar de novo.',
      }, 409);
    }

    const res = await fetch(`${baseDoAsaas(chave)}/subscriptions/${encodeURIComponent(assinatura)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', access_token: chave },
    });

    // 404 = já não existe lá. Para o lojista o resultado é o mesmo (não será
    // cobrado), e tratar como erro o faria clicar de novo para sempre.
    if (!res.ok && res.status !== 404) {
      const corpo = await res.text();
      console.error('[assinatura-cancelar] Asaas recusou:', res.status, corpo.slice(0, 300));
      return json({
        error: 'Não consegui cancelar agora. Tente de novo em instantes — '
             + 'e se continuar, fale com o suporte para a gente encerrar manualmente.',
      }, 502);
    }

    console.log('[assinatura-cancelar] assinatura encerrada', {
      user: user.id, assinatura, status: res.status,
    });

    // O estado muda quando o `SUBSCRIPTION_DELETED` chegar, em segundos. A tela
    // avisa que foi pedido e reconsulta.
    return json({ success: true });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[assinatura-cancelar] exceção:', msg);
    return json({ error: msg }, 500);
  }
});
