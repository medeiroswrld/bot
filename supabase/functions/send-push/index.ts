// send-push — entrega notificação no celular do lojista via Web Push.
//
// Função SEPARADA de propósito: o whatsapp-webhook é caminho crítico (mensagem
// de cliente não pode se perder), e push é acessório. Chamando daqui, qualquer
// falha de envio morre nesta função em vez de derrubar o processamento.
//
// A API Notification que o CRM já usava só dispara com a aba aberta — ou seja,
// só quando o lojista já está olhando. Esta é a que chega com o app fechado.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const { user_id, titulo, corpo, url, tag } = await req.json();
    if (!user_id) return json({ error: 'user_id obrigatório' }, 400);

    const publica = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
    const privada = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
    const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contato@amply.ia.br';
    if (!publica || !privada) return json({ error: 'VAPID não configurado' }, 500);

    webpush.setVapidDetails(subject, publica, privada);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: inscricoes } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', user_id);

    if (!inscricoes?.length) return json({ enviados: 0, motivo: 'nenhum aparelho inscrito' });

    const payload = JSON.stringify({
      titulo: titulo || 'Amply',
      corpo:  corpo  || 'Nova mensagem de cliente',
      url:    url    || '/conversas',
      ...(tag ? { tag } : {}),
    });

    let enviados = 0;
    const mortas: string[] = [];

    for (const s of inscricoes) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        enviados++;
      } catch (e) {
        // 404/410 = inscrição morta (app desinstalado, permissão revogada).
        // Guardar isso pra sempre significa tentar entregar a um endereço que
        // não existe em toda mensagem que chega.
        const status = (e as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) mortas.push(s.id);
        else console.error('[send-push] falha no envio:', status, (e as Error)?.message);
      }
    }

    if (mortas.length) {
      await supabase.from('push_subscriptions').delete().in('id', mortas);
      console.log(`[send-push] ${mortas.length} inscrição(ões) morta(s) removida(s)`);
    }

    return json({ enviados, removidas: mortas.length, total: inscricoes.length });
  } catch (e) {
    console.error('[send-push] exceção:', e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
