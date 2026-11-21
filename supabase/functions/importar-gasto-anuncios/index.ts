// importar-gasto-anuncios — traz o custo de cada anúncio da Meta pro CRM.
//
// É a metade que faltava da atribuição. A 072 captura o clique, os triggers da
// 073 enfileiram a conversão, a view `anuncio_desempenho` já dizia quantos
// leads e quanto faturamento cada anúncio trouxe — e **ninguém sabia quanto
// cada anúncio custou**. Sem isso não existe CPL, custo por venda nem ROAS.
//
// Roda por cron, uma vez por dia. Não é urgente como o envio da CAPI: gasto de
// ontem não muda nada se chegar às 6h ou às 9h, e a Meta ainda ajusta o número
// do dia corrente ao longo dele.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const GRAPH = 'https://graph.facebook.com/v25.0';

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

// Janela normal de reimportação.
//
// Não é só "pegar o de ontem": a Meta **revisa o gasto retroativamente**
// quando invalida cliques, às vezes dias depois. Reimportar os últimos 7 dias
// toda noite faz a correção entrar sozinha — e como a chave do banco é
// (loja, anúncio, dia), reimportar atualiza em vez de somar duas vezes.
const DIAS_JANELA = 7;

// Teto do backfill da primeira execução. A Marketing API aceita janelas bem
// maiores, mas puxar 2 anos de uma loja que começou ontem é desperdício, e
// anúncio velho não muda decisão nenhuma.
const DIAS_BACKFILL_MAX = 90;

const diaIso = (d: Date) => d.toISOString().slice(0, 10);

interface LinhaInsight {
  ad_id?: string;
  ad_name?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  date_start?: string;
}

Deno.serve(async (req) => {
  let corpo: Record<string, unknown> = {};
  try { corpo = await req.json(); } catch { /* cron manda vazio */ }

  // Parâmetros opcionais, pra reimportar um período à mão sem esperar o cron.
  const soEstaLoja = String(corpo?.user_id ?? '').trim() || null;
  const desdeParam = String(corpo?.desde ?? '').trim() || null;
  const ateParam   = String(corpo?.ate   ?? '').trim() || null;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const tokenGlobal = Deno.env.get('META_ADS_TOKEN') ?? '';

  // Lojas que têm clique de anúncio. Importar gasto de quem nunca rodou
  // anúncio seria chamada à toa — e sem `source_id` não há o que casar.
  let q = supabase.from('ad_referrals').select('user_id, source_id, created_at').not('source_id', 'is', null);
  if (soEstaLoja) q = q.eq('user_id', soEstaLoja);
  const { data: refs, error: erroRefs } = await q;

  if (erroRefs) {
    console.error('[gasto] falha ao ler ad_referrals:', erroRefs.message);
    return json({ error: erroRefs.message }, 500);
  }
  if (!refs?.length) return json({ lojas: 0, motivo: 'nenhum clique de anuncio registrado' });

  // Agrupa por loja, guardando o anúncio mais recente (serve pra descobrir a
  // conta) e o clique mais antigo (serve pra decidir o backfill).
  const porLoja = new Map<string, { ultimoAd: string; primeiroClique: string }>();
  for (const r of refs) {
    const uid = String(r.user_id);
    const criado = String(r.created_at ?? '');
    const atual = porLoja.get(uid);
    if (!atual) {
      porLoja.set(uid, { ultimoAd: String(r.source_id), primeiroClique: criado });
      continue;
    }
    if (criado > (atual.primeiroClique || '')) atual.ultimoAd = String(r.source_id);
    if (criado && criado < atual.primeiroClique) atual.primeiroClique = criado;
  }

  const resumo: Record<string, unknown>[] = [];

  for (const [userId, info] of porLoja) {
    const passo = (motivo: string, extra: Record<string, unknown> = {}) => {
      console.log(`[gasto] ${userId}: ${motivo}`, JSON.stringify(extra));
      resumo.push({ user_id: userId, resultado: motivo, ...extra });
    };

    // ── Token: o da loja manda; sem ele, o global da Amply ────────────────
    let token = tokenGlobal;
    const { data: tk } = await supabase.rpc('get_ads_token', { p_user_id: userId });
    if (tk && String(tk).trim()) token = String(tk).trim();
    if (!token) { passo('sem token de anuncios'); continue; }

    // ── Conta de anúncios: a guardada, ou descobre pelo anúncio ───────────
    const { data: cfg } = await supabase
      .from('company_settings')
      .select('meta_ad_account_id')
      .eq('user_id', userId)
      .maybeSingle();

    let conta = String(cfg?.meta_ad_account_id ?? '').replace(/^act_/, '').trim();

    if (!conta) {
      // Descoberta: o anúncio sabe de qual conta ele é. Evita pedir pro
      // lojista um número que ele não faz ideia de onde tirar.
      const r = await fetch(`${GRAPH}/${info.ultimoAd}?fields=account_id`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || !b?.account_id) {
        passo('nao consegui descobrir a conta de anuncios', {
          status: r.status, erro: b?.error?.message ?? null, ad_id: info.ultimoAd,
        });
        continue;
      }
      conta = String(b.account_id).replace(/^act_/, '');
      await supabase.from('company_settings')
        .update({ meta_ad_account_id: conta })
        .eq('user_id', userId);
      console.log(`[gasto] ${userId}: conta descoberta act_${conta}`);
    }

    // ── Janela ────────────────────────────────────────────────────────────
    //
    // Primeira importação da loja puxa desde o primeiro clique (com teto),
    // porque o CPL precisa do gasto do MESMO período dos leads — importar só
    // a última semana contra leads de três meses daria custo por lead
    // ridiculamente baixo, e errado.
    const hoje = new Date();
    let desde: string;
    const ate = ateParam || diaIso(hoje);

    if (desdeParam) {
      desde = desdeParam;
    } else {
      const { count } = await supabase
        .from('ad_insights')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      if ((count ?? 0) === 0) {
        const tetoBackfill = new Date(hoje.getTime() - DIAS_BACKFILL_MAX * 86400000);
        const primeiro = info.primeiroClique ? new Date(info.primeiroClique) : tetoBackfill;
        desde = diaIso(primeiro > tetoBackfill ? primeiro : tetoBackfill);
      } else {
        desde = diaIso(new Date(hoje.getTime() - DIAS_JANELA * 86400000));
      }
    }

    // ── Puxa os insights, página por página ───────────────────────────────
    const params = new URLSearchParams({
      level: 'ad',
      time_increment: '1',
      time_range: JSON.stringify({ since: desde, until: ate }),
      fields: 'ad_id,ad_name,campaign_name,spend,impressions,clicks',
      limit: '500',
    });

    let url: string | null = `${GRAPH}/act_${conta}/insights?${params.toString()}`;
    const linhas: LinhaInsight[] = [];
    let paginas = 0;

    while (url && paginas < 20) {   // teto de páginas: rede não pode virar loop infinito
      const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        passo('a Meta recusou a leitura de insights', {
          status: r.status, erro: b?.error?.message ?? null, conta: `act_${conta}`,
        });
        url = null;
        break;
      }
      if (Array.isArray(b?.data)) linhas.push(...b.data);
      // `paging.next` já vem com o token embutido pela Meta; mandar o nosso
      // header junto é inofensivo e mantém a chamada idêntica à primeira.
      url = b?.paging?.next ?? null;
      paginas++;
    }

    if (!linhas.length) {
      // Nem sempre é erro: loja sem veiculação no período cai aqui.
      if (!resumo.some((x) => x.user_id === userId)) passo('nenhum gasto no periodo', { desde, ate });
      continue;
    }

    const registros = linhas
      .filter((l) => l.ad_id && l.date_start)
      .map((l) => ({
        user_id:       userId,
        ad_id:         String(l.ad_id),
        dia:           String(l.date_start),
        ad_name:       l.ad_name ?? null,
        campaign_name: l.campaign_name ?? null,
        spend:         Number(l.spend ?? 0) || 0,
        impressions:   Number(l.impressions ?? 0) || 0,
        clicks:        Number(l.clicks ?? 0) || 0,
        atualizado_em: new Date().toISOString(),
      }));

    // onConflict na chave (loja, anúncio, dia): é o que faz a revisão
    // retroativa da Meta corrigir a linha em vez de criar uma segunda.
    const { error: erroUpsert } = await supabase
      .from('ad_insights')
      .upsert(registros, { onConflict: 'user_id,ad_id,dia' });

    if (erroUpsert) {
      passo('falha ao gravar o gasto', { erro: erroUpsert.message });
      continue;
    }

    const total = registros.reduce((s, r) => s + r.spend, 0);
    passo('ok', {
      desde, ate, conta: `act_${conta}`,
      linhas: registros.length,
      anuncios: new Set(registros.map((r) => r.ad_id)).size,
      gasto_total: Math.round(total * 100) / 100,
    });
  }

  return json({ lojas: porLoja.size, resumo });
});
