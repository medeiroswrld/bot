// continuar-campanhas — retoma disparo que parou no meio.
//
// POR QUE ISTO EXISTE:
// o `send-campaign` manda um LOTE por invocação (30) porque 200 numa só
// estourava o limite de recurso do runtime e a função morria com HTTP 546. Em
// 23/11 o "Convite Feirão" parou em 56 de 200 e ficou `sending` pra sempre,
// com 131 pessoas em `pending` — sem erro na tela, sem log vermelho. Ninguém
// descobriria sem abrir a tabela.
//
// Esta function é o que garante que o resto saia sozinho: o cron chama a cada
// 2 minutos, ela acha a campanha parada e pede o próximo lote.
//
// UMA campanha por invocação, de propósito: cada lote leva ~80s, e atender
// duas campanhas na mesma chamada reintroduziria exatamente o estouro de
// recurso que este desenho existe pra evitar.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Campanhas que se declaram em andamento. A mais antiga primeiro: quem
  // esperou mais tempo sai na frente.
  const { data: emAndamento, error } = await supabase
    .from('campaigns')
    .select('id, name, started_at')
    .eq('status', 'sending')
    .order('started_at', { ascending: true })
    .limit(20);

  if (error) {
    console.error('[continuar] falha ao ler campanhas:', error.message);
    return json({ error: error.message }, 500);
  }
  if (!emAndamento?.length) return json({ retomadas: 0, motivo: 'nenhuma campanha em andamento' });

  // Entre as em andamento, a primeira que de fato tem gente esperando.
  //
  // O status sozinho não basta: campanha que terminou mal pode ter ficado com
  // `sending` e zero pendentes, e aí chamar o send-campaign faria ele
  // reconstruir o público e DISPARAR DE NOVO pra base inteira. A conta de
  // pendentes é o que impede isso.
  for (const c of emAndamento) {
    const { count } = await supabase
      .from('campaign_sends')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id)
      .eq('status', 'pending');

    if ((count ?? 0) === 0) {
      // Sem pendente nenhum: fecha e segue. Deixar `sending` faria esta
      // function voltar aqui a cada 2 minutos pra sempre.
      await supabase.from('campaigns')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', c.id);
      console.log('[continuar] campanha sem pendentes — fechada', { id: c.id });
      continue;
    }

    console.log('[continuar] pedindo proximo lote', { id: c.id, pendentes: count });

    const r = await fetch(`${supabaseUrl}/functions/v1/send-campaign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ campaign_id: c.id }),
    });
    const corpo = await r.json().catch(() => ({}));

    return json({ retomadas: 1, campanha: c.id, pendentes_antes: count, status: r.status, resposta: corpo });
  }

  return json({ retomadas: 0, motivo: 'nenhuma com pendentes' });
});
