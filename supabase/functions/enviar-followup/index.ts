// enviar-followup — volta a falar com quem esfriou, dentro da janela de 24h.
//
// ── Por que existe ─────────────────────────────────────────────────────────
//
// O cliente pergunta do carro, o bot responde, manda foto, e ele some. Nada no
// sistema voltava a falar com ele — nunca. O lead morria em silêncio.
//
// ── Por que é de graça ─────────────────────────────────────────────────────
//
// A Meta cobra por TEMPLATE, não por mensagem. Dentro da janela de atendimento
// de 24 horas, texto livre é gratuito e dispensa aprovação. Esta função vive
// inteira dentro dessa janela, e por isso funciona nos dois canais e não
// esperou nenhuma aprovação para entrar no ar.
//
// E a mensagem é FIXA, não escrita pelo modelo. Também de propósito: sem
// chamada de LLM, o follow-up não tem custo marginal nenhum — nem de template,
// nem de token. A loja pode editar o texto, mas é um texto.
//
// ── O que impede isto de virar spam ────────────────────────────────────────
//
// Insistir é o que faz o cliente bloquear o número da loja, e isso não se
// desfaz. As travas, em ordem de importância:
//
//   • uma vez por conversa, para sempre (`followup_em`)
//   • só se o cliente falou de verdade (2+ mensagens dele)
//   • nunca se um atendente assumiu (status != 'bot')
//   • dentro do horário em que a loja atende
//   • respeita suspensão, plano sem bot e assinatura vencida
//   • respeita a lista de números bloqueados da loja
//
// As quatro primeiras vivem na view `conversas_para_followup` e aqui; as duas
// últimas vêm de `botGuards`, compartilhadas com todo o resto.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sendMessage, resolveWhatsAppToken } from '../_shared/whatsapp.ts';
import { enviarSocial } from '../_shared/social.ts';
import { botPodeResponder, numeroBloqueado, COLUNAS_GUARDA } from '../_shared/botGuards.ts';
import { buildCors } from '../_shared/cors.ts';

const PADRAO = 'E aí, o que achou? Se bateu alguma dúvida sobre o carro, é só me chamar por aqui.';

/** Hora atual em São Paulo, como número (14.5 = 14h30). */
function horaBR(): number {
  const s = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  const [h, m] = s.split(':').map(Number);
  return h + m / 60;
}

/** "18:00:00" -> 18 */
const hhmm = (t: unknown, padrao: number): number => {
  const p = String(t ?? '').slice(0, 5).split(':');
  const h = Number(p[0]), m = Number(p[1]);
  return Number.isFinite(h) ? h + (Number.isFinite(m) ? m / 60 : 0) : padrao;
};

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // A view já aplicou: loja com follow-up ligado, conversa com o bot, 2+
  // mensagens do cliente, a última palavra foi nossa, esfriou o bastante e a
  // janela de 24h ainda está aberta.
  const { data: candidatas, error: erroView } = await supabase
    .from('conversas_para_followup')
    .select('*')
    .limit(200);

  if (erroView) {
    console.error('[followup] falha ao ler candidatas:', erroView.message);
    return json({ erro: erroView.message }, 500);
  }
  if (!candidatas?.length) return json({ enviados: 0, candidatas: 0 });

  // Guardas e credenciais por LOJA, não por conversa: buscar isto a cada
  // mensagem faria uma consulta ao Vault por lead.
  const porLoja = new Map<string, {
    guardas: Record<string, unknown> | null;
    tokenWa: string;
    igUserId: string;
    fbPageId: string;
    tokenSocial: Record<string, string>;
  }>();

  let enviados = 0, pulados = 0;

  for (const c of candidatas) {
    const userId = String(c.user_id);

    if (!porLoja.has(userId)) {
      const { data: cfg } = await supabase
        .from('company_settings')
        .select(`${COLUNAS_GUARDA}, ig_user_id, fb_page_id`)
        .eq('user_id', userId)
        .maybeSingle();
      porLoja.set(userId, {
        guardas: cfg as Record<string, unknown> | null,
        tokenWa: '',
        igUserId: String((cfg as { ig_user_id?: string })?.ig_user_id ?? ''),
        fbPageId: String((cfg as { fb_page_id?: string })?.fb_page_id ?? ''),
        tokenSocial: {},
      });
    }
    const loja = porLoja.get(userId)!;

    // Mesmas travas do bot. Loja suspensa, plano sem bot ou assinatura vencida
    // não manda follow-up — seria o sistema falando por uma loja que ele já
    // calou em todo o resto.
    if (!botPodeResponder(loja.guardas ?? undefined)) { pulados++; continue; }

    // Horário. `botPodeResponder` já cobre a janela quando a loja configurou
    // uma; quando não configurou, ele libera 24h — e aí o default existe para
    // o follow-up não sair às 3 da manhã, que é diferente de RESPONDER às 3 da
    // manhã. Responder tarde é serviço; puxar assunto tarde é incômodo.
    const g = (loja.guardas ?? {}) as Record<string, unknown>;
    if (g.bot_schedule_enabled !== true) {
      const agora = horaBR();
      if (agora < 9 || agora >= 20) { pulados++; continue; }
    }

    const destino = String(c.customer_phone ?? '');
    if (!destino) { pulados++; continue; }
    if (numeroBloqueado(g.bot_blocked_numbers, destino)) { pulados++; continue; }

    const texto = String(c.followup_mensagem ?? '').trim() || PADRAO;
    const canal = String(c.channel ?? 'whatsapp');
    let ok = false;

    try {
      if (canal === 'instagram' || canal === 'messenger') {
        const contaId = canal === 'instagram' ? loja.igUserId : loja.fbPageId;
        if (!loja.tokenSocial[canal]) {
          const { data: tk } = await supabase.rpc('get_meta_page_token', {
            p_user_id: userId, p_canal: canal,
          });
          loja.tokenSocial[canal] = String(tk ?? '');
        }
        const r = await enviarSocial(
          contaId, destino, texto, loja.tokenSocial[canal], canal as 'instagram' | 'messenger',
        );
        ok = r.ok;
        if (!ok) console.error('[followup] envio social recusado:', r.erro);
      } else {
        if (!loja.tokenWa) loja.tokenWa = await resolveWhatsAppToken(supabase, userId);
        ok = await sendMessage(
          destino, texto, String(c.phone_number_id ?? '') || undefined, loja.tokenWa,
        );
      }
    } catch (e) {
      console.error('[followup] exceção no envio:', e instanceof Error ? e.message : String(e));
      ok = false;
    }

    if (!ok) { pulados++; continue; }

    // A mensagem entra no histórico como qualquer outra do bot. Sem isto, o
    // modelo não saberia que já puxou assunto e repetiria a pergunta na vez
    // seguinte — e o cliente leria duas vezes a mesma frase.
    await supabase.from('messages').insert({
      conversation_id: c.conversation_id,
      role: 'bot',
      content: texto,
    });

    // Marca ANTES de contar: se algo falhar depois daqui, o pior caso é o
    // follow-up não ter saído. O contrário — marcar depois e falhar — mandaria
    // a mesma mensagem de novo na próxima rodada.
    await supabase.from('conversations')
      .update({ followup_em: new Date().toISOString(), last_message_at: new Date().toISOString() })
      .eq('id', c.conversation_id);

    enviados++;
  }

  console.log('[followup] rodada concluída', { candidatas: candidatas.length, enviados, pulados });
  return json({ candidatas: candidatas.length, enviados, pulados });
});
