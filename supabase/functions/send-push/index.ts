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
    const body = await req.json();
    const { titulo, corpo, url, tag } = body;

    // Quem pode notificar QUEM.
    //
    // O webhook chama com a service_role e precisa notificar o dono da loja, que
    // não é ele. Mas o CRM também chama daqui (botão de testar), e aí aceitar o
    // `user_id` do corpo deixaria qualquer usuário autenticado disparar
    // notificação no celular de outra loja. Então: service_role manda no corpo,
    // usuário comum é forçado ao próprio id.
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    let papel = '';
    try {
      papel = String(JSON.parse(atob(token.split('.')[1] ?? '')).role ?? '');
    } catch { /* token ilegível: cai no caminho restrito abaixo */ }

    let user_id = body.user_id;
    if (papel !== 'service_role') {
      const anon = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const { data: { user } } = await anon.auth.getUser(token);
      if (!user) return json({ error: 'Não autenticado' }, 401);
      user_id = user.id;
    }

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

    // Log com o user_id: quando a notificacao nao chega, a primeira duvida e
    // sempre se o disparo mirou a conta certa. Sem isto so da pra adivinhar.
    console.log(`[send-push] alvo=${user_id} papel=${papel || 'usuario'} inscricoes=${inscricoes?.length ?? 0}`);

    if (!inscricoes?.length) {
      console.warn(`[send-push] NENHUM aparelho inscrito para ${user_id}`);
      return json({ enviados: 0, motivo: 'nenhum aparelho inscrito', alvo: user_id });
    }

    const payload = JSON.stringify({
      titulo: titulo || 'Amply',
      corpo:  corpo  || 'Nova mensagem de cliente',
      url:    url    || '/conversas',
      ...(tag ? { tag } : {}),
    });

    let enviados = 0;
    const mortas: string[] = [];
    // Resultado POR APARELHO. O total sozinho engana: "3 enviados" com o iPhone
    // recusado parece sucesso e e o cenario que mais custou tempo aqui.
    const detalhes: Array<Record<string, unknown>> = [];

    for (const s of inscricoes) {
      const apple = /apple/i.test(String(s.endpoint));
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        enviados++;
        detalhes.push({ servico: apple ? 'Apple' : 'Google', ok: true });
      } catch (e) {
        // 404/410 = inscrição morta (app desinstalado, permissão revogada).
        // Guardar isso pra sempre significa tentar entregar a um endereço que
        // não existe em toda mensagem que chega.
        const status = (e as { statusCode?: number })?.statusCode;
        const msg = (e as { body?: string })?.body ?? (e as Error)?.message ?? '';
        detalhes.push({ servico: apple ? 'Apple' : 'Google', ok: false, status, erro: String(msg).slice(0, 200) });
        if (status === 404 || status === 410) mortas.push(s.id);
        else console.error('[send-push] falha no envio:', apple ? 'Apple' : 'Google', status, msg);
      }
    }

    if (mortas.length) {
      await supabase.from('push_subscriptions').delete().in('id', mortas);
      console.log(`[send-push] ${mortas.length} inscrição(ões) morta(s) removida(s)`);
    }

    console.log(`[send-push] resultado: enviados=${enviados} de ${inscricoes.length}, removidas=${mortas.length}`);
    // Formato do subject: a Apple exige mailto: ou https: e RECUSA o que a
    // Google aceita calado. Reporta a validade sem expor o valor.
    const subjectOk = /^(mailto:\S+@\S+|https:\/\/)/.test(subject);
    return json({ enviados, removidas: mortas.length, total: inscricoes.length, detalhes, subjectOk });
  } catch (e) {
    console.error('[send-push] exceção:', e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
