import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildCors } from '../_shared/cors.ts';

// Avisa quando o bot deveria ter respondido e não respondeu.
//
// ── Por que isto existe ────────────────────────────────────────────────────
//
// Em dois dias apareceram dois defeitos que calavam o bot sem gerar um único
// erro: o eco do próprio envio marcando a conversa como humana, e a mensagem
// que chegava durante a geração tendo a chave queimada por quem não processou
// nada. Os dois sangraram lead por semanas, e os dois foram descobertos porque
// o lojista leu uma conversa por acaso.
//
// Mais trava não resolve esse tipo de defeito — sempre vai existir um caminho
// que ninguém previu. O que faltava era PERCEBER. Este alarme não impede nada;
// ele garante que, quando acontecer de novo, alguém saiba em dez minutos em
// vez de em três semanas.
//
// ── Quem é avisado ─────────────────────────────────────────────────────────
//
// A loja, não nós. Quem pode salvar o lead é o vendedor que abre o CRM e
// responde — e ele descobre o defeito pra gente, como aconteceu desta vez.
//
// ── Uma vez por conversa ───────────────────────────────────────────────────
//
// `alerta_mudo_em` marca a que já foi avisada. Sem isso, a cada 15 minutos a
// mesma conversa notificaria de novo, e alarme que repete vira alarme que se
// ignora — que é o mesmo que não ter.

Deno.serve(async (req) => {
  const CORS = buildCors(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const url        = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: mudas, error } = await admin
    .from('conversas_mudas')
    .select('id, user_id, customer_name, customer_phone, channel, last_message_at')
    .limit(50);

  if (error) {
    console.error('[alerta-mudo] falha ao consultar:', error.message);
    return json({ error: error.message }, 500);
  }

  const lista = mudas ?? [];
  if (!lista.length) return json({ mudas: 0 });

  // Volume alto numa rodada só não é lojista devagar — é defeito. Fica no log
  // como erro de propósito, para aparecer em qualquer varredura de logs.
  if (lista.length >= 3) {
    console.error(`[alerta-mudo] ${lista.length} conversas mudas de uma vez — cheiro de defeito, nao de demora`);
  }

  let avisadas = 0;
  for (const c of lista) {
    const quem = c.customer_name || c.customer_phone || 'Um cliente';
    const canal = c.channel === 'instagram' ? 'no Instagram'
                : c.channel === 'messenger' ? 'no Messenger'
                : 'no WhatsApp';

    try {
      const res = await fetch(`${url}/functions/v1/send-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          user_id: c.user_id,
          titulo: 'Cliente esperando resposta',
          corpo: `${quem} escreveu ${canal} e ninguém respondeu.`,
          url: '/conversas',
          // Tag por conversa: se duas caírem juntas, o celular mostra as duas
          // em vez de uma sobrescrever a outra.
          tag: `mudo-${c.id}`,
        }),
      });
      if (!res.ok) console.error(`[alerta-mudo] push falhou para ${c.id}: HTTP ${res.status}`);
      else avisadas++;
    } catch (e) {
      console.error(`[alerta-mudo] push falhou para ${c.id}:`, e instanceof Error ? e.message : String(e));
    }

    // Marca mesmo quando o push falha. Tentar de novo a cada 15 minutos uma
    // notificação que não entrega só enche o log — e o lojista continua vendo
    // a conversa na tela de Conversas, que é a rede de segurança de verdade.
    await admin
      .from('conversations')
      .update({ alerta_mudo_em: new Date().toISOString() })
      .eq('id', c.id);
  }

  console.log(`[alerta-mudo] ${lista.length} mudas, ${avisadas} avisadas`);
  return json({ mudas: lista.length, avisadas });
});
