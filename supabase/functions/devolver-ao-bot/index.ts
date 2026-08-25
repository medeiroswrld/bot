// devolver-ao-bot — devolve ao bot a conversa que o atendente abandonou.
//
// O atendente assume, responde uma ou duas vezes e some: cliente na loja,
// almoço, fim do expediente. A conversa trava em "humano" e o cliente do outro
// lado não recebe mais nada. Nada quebra, ninguém é avisado, e o lead morre em
// silêncio — que é o pior tipo de falha que este produto pode ter.
//
// Roda por cron. Cada loja escolhe se quer e depois de quantos minutos.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Só lojas que ligaram a devolução.
  const { data: lojas, error: erroLojas } = await supabase
    .from('company_settings')
    .select('user_id, auto_return_minutes')
    .eq('auto_return_enabled', true);

  if (erroLojas) {
    console.error('[devolver] falha ao ler lojas:', erroLojas.message);
    return json({ error: erroLojas.message }, 500);
  }
  if (!lojas?.length) return json({ lojas: 0, devolvidas: 0 });

  let devolvidas = 0;
  const acionar: string[] = [];

  for (const loja of lojas) {
    const minutos = Math.max(1, Number(loja.auto_return_minutes) || 15);
    const limite = new Date(Date.now() - minutos * 60_000).toISOString();

    const { data: paradas, error } = await supabase
      .from('conversations')
      .select('id, customer_name')
      .eq('user_id', loja.user_id)
      .eq('status', 'human')
      .lt('last_message_at', limite);

    if (error) {
      console.error('[devolver] falha ao buscar conversas:', error.message);
      continue;
    }
    if (!paradas?.length) continue;

    for (const conv of paradas) {
      // Quem falou por último decide o que acontece depois de devolver.
      //
      // Cliente por último = ele está esperando resposta, e devolver sem
      // responder só troca a etiqueta. Atendente por último = a bola está com o
      // cliente; devolver em silêncio basta, e fazer o bot falar aqui seria ele
      // se intrometendo num assunto que não acompanhou.
      const { data: ultima } = await supabase
        .from('messages')
        .select('role')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const clienteEsperando = ultima?.role === 'customer';

      const { error: erroUp } = await supabase
        .from('conversations')
        .update({ status: 'bot' })
        .eq('id', conv.id)
        .eq('status', 'human');   // condição de corrida: se o atendente voltou
                                  // agora, a conversa já não está em 'human' e
                                  // este update não faz nada. Melhor perder a
                                  // devolução do que arrancar a conversa das
                                  // mãos de alguém que acabou de responder.

      if (erroUp) {
        console.error('[devolver] falha ao devolver:', erroUp.message);
        continue;
      }

      devolvidas++;
      if (clienteEsperando) acionar.push(conv.id);
      console.log(`[devolver] conversa ${conv.id} devolvida ao bot (${minutos}min, cliente esperando: ${clienteEsperando})`);
    }
  }

  // Aciona o bot para as que têm cliente esperando. Sequencial e com o
  // resultado ignorado de propósito: se uma falhar, as outras seguem.
  for (const id of acionar) {
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-conversation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ conversation_id: id }),
    }).catch((e) => console.warn('[devolver] falha ao acionar o bot:', e));
  }

  return json({ lojas: lojas.length, devolvidas, acionadas: acionar.length });
});
