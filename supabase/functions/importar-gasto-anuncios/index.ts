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

  // Agrupa por loja: o anúncio mais recente (pra descobrir a conta), o clique
  // mais antigo (pra decidir o backfill) e TODOS os ad_ids da loja — estes
  // servem pra reconhecer qual conta é a dela quando a descoberta direta
  // falhar (ver o terceiro degrau abaixo).
  const porLoja = new Map<string, { ultimoAd: string; primeiroClique: string; ads: Set<string> }>();
  for (const r of refs) {
    const uid = String(r.user_id);
    const criado = String(r.created_at ?? '');
    const atual = porLoja.get(uid);
    if (!atual) {
      porLoja.set(uid, { ultimoAd: String(r.source_id), primeiroClique: criado, ads: new Set([String(r.source_id)]) });
      continue;
    }
    atual.ads.add(String(r.source_id));
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

    const pegar = async (caminho: string) => {
      const r = await fetch(`${GRAPH}/${caminho}`, { headers: { Authorization: `Bearer ${token}` } });
      const b = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, body: b };
    };

    // Modo diagnóstico: mostra o que o token ALCANÇA, sem gravar nada.
    //
    // Existe porque "nenhum gasto no período" tem duas causas opostas — a
    // conta certa sem veiculação, e a conta errada — e de fora elas são
    // idênticas. `amount_spent` é o acumulado da vida da conta: conta com
    // dinheiro gasto e zero no período é veiculação; conta zerada na vida
    // inteira é a conta errada.
    if (corpo?.diagnostico) {
      // Sem o campo `business`: ele exige `business_management`, que este
      // token não tem, e pedir um campo a mais derruba a resposta INTEIRA
      // com (#100) em vez de só omitir o campo.
      const listadas = await pegar('me/adaccounts?fields=id,name,amount_spent,currency,account_status&limit=50');

      // Escopos REAIS do token. A tela de consentimento mostrar o botão em
      // "SIM" não prova que a permissão foi concedida — e perseguir uma
      // permissão que já está lá é perder o dia no lugar errado.
      const escopos = await pegar('me/permissions');

      // Sonda a conta configurada por DOIS caminhos, porque eles falham por
      // motivos diferentes: ler o OBJETO da conta é acesso de cadastro, ler
      // o INSIGHT é acesso a desempenho. Saber qual dos dois cai separa
      // "não enxergo a conta" de "enxergo mas não posso ver o gasto".
      const { data: cfgDiag } = await supabase
        .from('company_settings')
        .select('meta_ad_account_id')
        .eq('user_id', userId)
        .maybeSingle();

      const alvo = String(cfgDiag?.meta_ad_account_id ?? '').replace(/^act_/, '').trim();
      let objeto: unknown = null;
      let insight: unknown = null;
      if (alvo) {
        const o = await pegar(`act_${alvo}?fields=id,name,account_status,amount_spent,currency`);
        objeto = o.ok ? o.body : { erro: o.body?.error?.message ?? o.status };
        const i = await pegar(`act_${alvo}/insights?fields=spend&date_preset=maximum`);
        insight = i.ok ? (i.body?.data ?? []) : { erro: i.body?.error?.message ?? i.status };
      }

      passo('diagnostico', {
        escopos_do_token: (escopos.body?.data ?? [])
          .filter((p: { status?: string }) => p.status === 'granted')
          .map((p: { permission?: string }) => p.permission),
        contas_listadas: listadas.body?.data ?? listadas.body?.error?.message ?? null,
        conta_alvo: alvo ? `act_${alvo}` : null,
        leitura_do_objeto: objeto,
        leitura_do_insight: insight,
        ads_que_procuramos: [...info.ads],
      });
      continue;
    }

    // ── De quais contas puxar, em três degraus ────────────────────────────
    //
    // Três e não um porque cada degrau falha num caso real diferente:
    //
    //  1. a guardada — depois da primeira vez, não se pergunta mais nada;
    //  2. pelo próprio anúncio — resolve sem o lojista saber número nenhum;
    //  3. todas as contas que o token enxerga — o degrau 2 devolveu 400
    //     ("does not exist, cannot be loaded due to missing permissions")
    //     em 21/11 mesmo com o token listando duas contas ativas. Ler o
    //     OBJETO do anúncio exige mais permissão do que ler o insight da
    //     conta, então dá pra ter acesso ao gasto e não conseguir abrir o
    //     anúncio. Sem este degrau a importação morria aí.
    const { data: cfg } = await supabase
      .from('company_settings')
      .select('meta_ad_account_id')
      .eq('user_id', userId)
      .maybeSingle();

    const guardada = String(cfg?.meta_ad_account_id ?? '').replace(/^act_/, '').trim();
    let contas: string[] = [];
    let origemDaConta = 'guardada';

    if (guardada) {
      contas = [guardada];
    } else {
      const porAnuncio = await pegar(`${info.ultimoAd}?fields=account_id`);
      if (porAnuncio.ok && porAnuncio.body?.account_id) {
        contas = [String(porAnuncio.body.account_id).replace(/^act_/, '')];
        origemDaConta = 'descoberta pelo anuncio';
      } else {
        // `/me/adaccounts` só responde pra token de USUÁRIO; pra usuário de
        // sistema a Graph devolve 400 (edge errado pra essa identidade).
        const minhas = await pegar('me/adaccounts?fields=id&limit=50');
        if (minhas.ok && Array.isArray(minhas.body?.data) && minhas.body.data.length) {
          contas = minhas.body.data.map((c: { id?: string }) => String(c.id ?? '').replace(/^act_/, '')).filter(Boolean);
          origemDaConta = 'todas as contas do token';
        } else {
          passo('nao consegui descobrir a conta de anuncios', {
            erro_anuncio: porAnuncio.body?.error?.message ?? null,
            erro_contas:  minhas.body?.error?.message ?? null,
          });
          continue;
        }
      }
    }

    // ── Janela ────────────────────────────────────────────────────────────
    //
    // Primeira importação da loja puxa desde o primeiro clique (com teto),
    // porque o CPL precisa do gasto do MESMO período dos leads — importar só
    // a última semana contra leads de três meses daria custo por lead
    // ridiculamente baixo, e errado.
    const hoje = new Date();
    const ate = ateParam || diaIso(hoje);
    let desde: string;

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

    // ── Puxa os insights de cada conta candidata ──────────────────────────
    const registros: Record<string, unknown>[] = [];
    const contasQueBateram = new Set<string>();
    const errosPorConta: Record<string, string> = {};

    for (const conta of contas) {
      const params = new URLSearchParams({
        level: 'ad',
        time_increment: '1',
        time_range: JSON.stringify({ since: desde, until: ate }),
        fields: 'ad_id,ad_name,campaign_name,spend,impressions,clicks',
        limit: '500',
      });

      let url: string | null = `${GRAPH}/act_${conta}/insights?${params.toString()}`;
      let paginas = 0;

      while (url && paginas < 20) {   // teto de páginas: rede não pode virar loop infinito
        const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) {
          errosPorConta[`act_${conta}`] = String(b?.error?.message ?? r.status);
          break;
        }
        for (const l of (Array.isArray(b?.data) ? b.data : []) as LinhaInsight[]) {
          if (!l.ad_id || !l.date_start) continue;
          // Marca a conta que contém anúncio NOSSO: é o que permite gravar a
          // conta certa quando viemos do degrau 3 (várias candidatas).
          if (info.ads.has(String(l.ad_id))) contasQueBateram.add(conta);
          registros.push({
            user_id:       userId,
            ad_id:         String(l.ad_id),
            dia:           String(l.date_start),
            ad_name:       l.ad_name ?? null,
            campaign_name: l.campaign_name ?? null,
            spend:         Number(l.spend ?? 0) || 0,
            impressions:   Number(l.impressions ?? 0) || 0,
            clicks:        Number(l.clicks ?? 0) || 0,
            atualizado_em: new Date().toISOString(),
          });
        }
        url = b?.paging?.next ?? null;
        paginas++;
      }
    }

    if (!registros.length) {
      passo('nenhum gasto no periodo', {
        desde, ate, contas: contas.map((c) => `act_${c}`), origem: origemDaConta,
        erros: Object.keys(errosPorConta).length ? errosPorConta : undefined,
      });
      continue;
    }

    // onConflict na chave (loja, anúncio, dia): é o que faz a revisão
    // retroativa da Meta corrigir a linha em vez de criar uma segunda.
    const { error: erroUpsert } = await supabase
      .from('ad_insights')
      .upsert(registros, { onConflict: 'user_id,ad_id,dia' });

    if (erroUpsert) {
      passo('falha ao gravar o gasto', { erro: erroUpsert.message });
      continue;
    }

    // Só grava a conta quando UMA bateu. Duas contendo anúncio da mesma loja
    // é possível (ela migrou de conta), e fixar uma no chute faria a
    // importação de amanhã perder a outra em silêncio — melhor seguir
    // perguntando todo dia do que guardar a resposta errada.
    if (!guardada && contasQueBateram.size === 1) {
      const escolhida = [...contasQueBateram][0];
      await supabase.from('company_settings')
        .update({ meta_ad_account_id: escolhida })
        .eq('user_id', userId);
      console.log(`[gasto] ${userId}: conta gravada act_${escolhida}`);
    }

    const total = registros.reduce((s, r) => s + Number(r.spend ?? 0), 0);
    passo('ok', {
      desde, ate, origem: origemDaConta,
      contas_consultadas: contas.map((c) => `act_${c}`),
      conta_com_anuncio_nosso: [...contasQueBateram].map((c) => `act_${c}`),
      linhas: registros.length,
      anuncios: new Set(registros.map((r) => r.ad_id)).size,
      gasto_total: Math.round(total * 100) / 100,
      erros: Object.keys(errosPorConta).length ? errosPorConta : undefined,
    });
  }

  return json({ lojas: porLoja.size, resumo });
});
