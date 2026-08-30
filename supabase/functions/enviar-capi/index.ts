// enviar-capi — devolve as conversões pra Meta.
//
// O ciclo fecha aqui. A 072 capturou o clique no anúncio; os triggers da 073
// enfileiram "esse lead qualificou / agendou visita / comprou"; esta function
// entrega isso pra Meta, que passa a otimizar por comprador em vez de por
// conversa iniciada.
//
// Roda por cron. Fila e não envio na hora: chamada HTTP dentro do trigger
// travaria a escrita do CRM quando a Meta demorasse.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

// A Meta descarta qualquer evento cujo clique tenha mais de 7 dias. Marcamos
// como 'expirado' em vez de mandar: economiza a chamada e, mais importante,
// deixa registrado no CRM que a venda VEIO do anúncio mesmo tendo passado da
// janela — que é informação de negócio, ainda que não sirva pro algoritmo.
const JANELA_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_TENTATIVAS = 5;
const LOTE = 200;

interface Referral { ctwa_clid: string | null; created_at: string }

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Hint explícito da coluna no embed. Sem ele, no dia em que capi_events
  // ganhar uma segunda FK pra ad_referrals o PostgREST devolve erro de
  // ambiguidade e a fila para em silêncio — foi o que aconteceu com
  // leads/cars e zerou a lista de leads.
  const { data: eventos, error: erroEventos } = await supabase
    .from('capi_events')
    .select('id, user_id, lead_id, event_name, event_time, valor, moeda, tentativas, ad_referrals!ad_referral_id(ctwa_clid, created_at)')
    .eq('status', 'pendente')
    .lt('tentativas', MAX_TENTATIVAS)
    .order('created_at', { ascending: true })
    .limit(LOTE);

  if (erroEventos) {
    console.error('[capi] falha ao ler a fila:', erroEventos.message);
    return json({ error: erroEventos.message }, 500);
  }
  if (!eventos?.length) return json({ pendentes: 0 });

  // Configuração por loja, uma leitura só.
  const userIds = [...new Set(eventos.map((e) => e.user_id))];
  const { data: lojas } = await supabase
    .from('company_settings')
    .select('user_id, capi_enabled, capi_dataset_id, whatsapp_business_account_id, suspenso')
    .in('user_id', userIds);

  const porLoja = new Map((lojas ?? []).map((l) => [l.user_id, l]));
  const tokenGlobal = (Deno.env.get('META_CAPI_TOKEN') ?? '').trim();
  const tokenDaLoja = new Map<string, string>();

  let enviados = 0, expirados = 0, erros = 0, pulados = 0;

  for (const ev of eventos) {
    const loja = porLoja.get(ev.user_id);

    // Loja sem integração ligada, sem dataset, ou suspensa: o evento fica
    // pendente de propósito. Se a integração for ligada depois, o histórico
    // ainda sai — enquanto estiver dentro da janela.
    if (!loja || loja.capi_enabled !== true || !loja.capi_dataset_id || loja.suspenso === true) {
      pulados++;
      continue;
    }

    const ref = ev.ad_referrals as unknown as Referral | null;
    const clid = ref?.ctwa_clid ?? null;
    const waba = loja.whatsapp_business_account_id;

    // Sem clique ou sem WABA não há como a Meta casar o evento. Não adianta
    // tentar de novo amanhã: o dado não vai aparecer sozinho.
    if (!clid || !waba) {
      await supabase.from('capi_events').update({
        status: 'erro',
        ultimo_erro: !clid ? 'sem ctwa_clid' : 'loja sem whatsapp_business_account_id',
        tentativas: MAX_TENTATIVAS,
      }).eq('id', ev.id);
      erros++;
      continue;
    }

    const idadeDoClique = Date.now() - new Date(ref!.created_at).getTime();
    if (idadeDoClique > JANELA_MS) {
      await supabase.from('capi_events')
        .update({ status: 'expirado', ultimo_erro: 'clique com mais de 7 dias' })
        .eq('id', ev.id);
      expirados++;
      continue;
    }

    if (!tokenDaLoja.has(ev.user_id)) {
      const { data: tk } = await supabase.rpc('get_capi_token', { p_user_id: ev.user_id });
      tokenDaLoja.set(ev.user_id, String(tk ?? '').trim() || tokenGlobal);
    }
    const token = tokenDaLoja.get(ev.user_id) ?? '';
    if (!token) {
      pulados++;
      continue;
    }

    const evento: Record<string, unknown> = {
      event_name: ev.event_name,
      // A Meta espera segundos, não milissegundos. Mandar ms coloca o evento
      // a 50 mil anos no futuro e ela descarta sem reclamar.
      event_time: Math.floor(new Date(ev.event_time).getTime() / 1000),
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      // O id da linha vira o event_id: se o mesmo evento for reenviado depois
      // de um timeout que na verdade deu certo, a Meta deduplica sozinha.
      event_id: ev.id,
      user_data: {
        whatsapp_business_account_id: waba,
        ctwa_clid: clid,
      },
    };

    if (ev.valor != null) {
      evento.custom_data = { currency: ev.moeda ?? 'BRL', value: Number(ev.valor) };
    }

    try {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${loja.capi_dataset_id}/events`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: [evento],
            partner_agent: 'amply',
            access_token: token,
          }),
        },
      );

      const corpo = await res.text();

      if (res.ok) {
        await supabase.from('capi_events').update({
          status: 'enviado',
          enviado_em: new Date().toISOString(),
          tentativas: (ev.tentativas ?? 0) + 1,
          ultimo_erro: null,
        }).eq('id', ev.id);
        enviados++;
        console.log(`[capi] ${ev.event_name} enviado (lead ${ev.lead_id})`);
      } else {
        // Guarda o corpo do erro: a Meta responde 400 com a razão exata, e sem
        // isso o diagnóstico vira adivinhação — foi o que custou caro no push.
        await supabase.from('capi_events').update({
          status: 'pendente',
          tentativas: (ev.tentativas ?? 0) + 1,
          ultimo_erro: corpo.slice(0, 500),
        }).eq('id', ev.id);
        erros++;
        console.error(`[capi] ${res.status} no evento ${ev.id}: ${corpo.slice(0, 300)}`);
      }
    } catch (e) {
      await supabase.from('capi_events').update({
        status: 'pendente',
        tentativas: (ev.tentativas ?? 0) + 1,
        ultimo_erro: String(e).slice(0, 500),
      }).eq('id', ev.id);
      erros++;
      console.error(`[capi] exceção no evento ${ev.id}:`, e);
    }
  }

  console.log(`[capi] fila=${eventos.length} enviados=${enviados} expirados=${expirados} erros=${erros} pulados=${pulados}`);
  return json({ fila: eventos.length, enviados, expirados, erros, pulados });
});
