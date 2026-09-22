import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildCors } from '../_shared/cors.ts';

// Instagram Business Login — conecta o Direct da loja sem ela colar ID nem
// token na mão.
//
// ── Por que NÃO é o mesmo fluxo do WhatsApp ────────────────────────────────
//
// O `conectar-whatsapp` usa Facebook Login (FB.login com config_id). Este aqui
// não pode: as permissões `instagram_business_basic` e
// `instagram_business_manage_messages` pertencem ao "Instagram API with
// Instagram Login", que é um REDIRECT para instagram.com — o lojista entra com
// a conta do Instagram, não com a do Facebook, e não precisa de Página.
//
// Consequência prática boa: o `code` daqui vive 1 HORA, não 30 segundos. Some
// toda a pressa que obrigou o desenho de três peças em paralelo do WhatsApp.
//
// ── A armadilha dos dois IDs ───────────────────────────────────────────────
//
// A troca do token devolve um `user_id`. NÃO é o que serve. Esse é o ID com
// escopo de aplicativo; o que chega em `entry.id` do webhook — e é por ele que
// o social-webhook acha a loja — é o `user_id` do `GET /me?fields=user_id`.
//
// Guardar o errado não dá erro em lugar nenhum: conecta, diz "pronto", e o bot
// fica mudo com um `ig_user_id não cadastrado` enterrado no log. Por isso os
// dois são lidos, comparados e devolvidos no relatório de etapas.
//
// ── Nada é gravado antes de tudo dar certo ─────────────────────────────────
//
// As chamadas à Meta acontecem TODAS antes da primeira escrita. Uma loja em
// produção que reconecta e falha no meio continua com o token antigo
// atendendo, em vez de virar meio-conectada e silenciosa.

const OAUTH_TOKEN  = 'https://api.instagram.com/oauth/access_token';
const GRAPH        = 'https://graph.instagram.com';
const GRAPH_VER    = 'v23.0';

Deno.serve(async (req) => {
  const CORS = buildCors(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  // Relatório por etapa: mostra ONDE parou. "Não funcionou" já custou dias
  // neste projeto.
  const etapas: Array<{ etapa: string; ok: boolean; detalhe?: string }> = [];
  const marcar = (etapa: string, ok: boolean, detalhe?: string) => {
    etapas.push({ etapa, ok, detalhe });
    console.log(`[conectar-ig] ${ok ? 'OK  ' : 'FALHA'} ${etapa}${detalhe ? ' — ' + detalhe : ''}`);
  };

  try {
    if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

    // 1. Quem é — pelo JWT, nunca pelo corpo. Vindo do corpo, qualquer usuário
    //    logado conectaria um Instagram na conta de outro.
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authorization ausente' }, 401);

    const url        = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const userClient = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userErr } =
      await userClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userErr || !user) return json({ error: 'Não autenticado' }, 401);

    let body: { code?: string; redirect_uri?: string; desconectar?: boolean };
    try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

    // ── Desconectar ──────────────────────────────────────────────────
    //
    // Mora aqui, e não em função própria, porque conectar e desconectar são um
    // par: o que um assina, o outro precisa cancelar. Separados, um ganha um
    // passo e o outro não — foi assim que o social-webhook nasceu como cópia do
    // whatsapp-webhook e passou meses sem as travas dele.
    if (body?.desconectar === true) {
      const admin = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: cfg } = await admin
        .from('company_settings')
        .select('ig_user_id')
        .eq('user_id', user.id)
        .maybeSingle();

      // Cancela a assinatura do webhook ANTES de largar o token — depois não
      // haveria com o que autenticar. Sem este passo a Meta continua mandando
      // mensagem que ninguém responde, e o log enche de "não cadastrado".
      //
      // Falhar aqui NÃO impede a desconexão. Token vencido, ou revogado do lado
      // do Instagram, devolve erro — e uma loja nessa situação é justamente
      // quem mais precisa conseguir desconectar. Desconexão que depende da Meta
      // cooperar é desconexão que trava quando mais importa.
      if (cfg?.ig_user_id) {
        try {
          const { data: tok } = await admin.rpc('get_meta_page_token', {
            p_user_id: user.id, p_canal: 'instagram',
          });
          if (tok) {
            const r = await fetch(
              `${GRAPH}/${GRAPH_VER}/${cfg.ig_user_id}/subscribed_apps`,
              { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` } },
            );
            marcar('cancelar a assinatura do webhook', r.ok, r.ok ? undefined : `a Meta respondeu ${r.status}`);
          } else {
            marcar('cancelar a assinatura do webhook', false, 'não havia token guardado');
          }
        } catch (e) {
          marcar('cancelar a assinatura do webhook', false, e instanceof Error ? e.message : String(e));
        }
      }

      const { error: remErr } = await admin.rpc('set_meta_page_token', {
        p_user_id: user.id, p_canal: 'instagram', p_token: '',
      });
      marcar('apagar o token', !remErr, remErr?.message);

      // O ig_user_id é o que o webhook usa pra achar a loja. Limpar ele é o que
      // de fato desliga o canal, mesmo que os passos acima tenham falhado.
      const { error: limpaErr } = await admin
        .from('company_settings')
        .update({
          ig_user_id:         null,
          ig_username:        null,
          ig_token_expira_em: null,
          updated_at:         new Date().toISOString(),
        })
        .eq('user_id', user.id);
      if (limpaErr) {
        marcar('desligar o canal', false, limpaErr.message);
        return json({ error: 'Não consegui limpar os dados da conexão.', etapas }, 500);
      }
      marcar('desligar o canal', true);

      return json({ success: true, desconectado: true, etapas });
    }

    const code        = String(body?.code ?? '').trim();
    const redirectUri = String(body?.redirect_uri ?? '').trim();
    if (!code)        return json({ error: 'code ausente (a autorização não concluiu).' }, 400);
    if (!redirectUri) return json({ error: 'redirect_uri ausente.' }, 400);

    // O redirect_uri não é usado para redirecionar — vai só para a Meta, que o
    // confere contra as URIs registradas. Ainda assim é conferido aqui: um
    // parâmetro que atravessa o servidor sem validação é um convite.
    if (!/^https:\/\/[a-z0-9.-]+\/conectar\/instagram\/?$/i.test(redirectUri)
        && !/^http:\/\/localhost:\d+\/conectar\/instagram\/?$/i.test(redirectUri)) {
      return json({ error: 'redirect_uri não reconhecida.' }, 400);
    }

    const appId     = Deno.env.get('INSTAGRAM_APP_ID') ?? '';
    const appSecret = Deno.env.get('INSTAGRAM_APP_SECRET') ?? '';
    if (!appId || !appSecret) {
      return json({
        error: 'INSTAGRAM_APP_ID ou INSTAGRAM_APP_SECRET não configurados nos Secrets. '
             + 'São diferentes do META_APP_ID: o app do Instagram tem ID e chave próprios.',
      }, 500);
    }

    // Nunca deixa o segredo nem o token vazarem pela mensagem de erro que volta
    // pro navegador. A Meta às vezes ecoa o que recebeu.
    const limpar = (t: string) => {
      let s = t.slice(0, 300);
      for (const seg of [appSecret, appId]) if (seg) s = s.replaceAll(seg, '[oculto]');
      return s;
    };

    // ── 2. code → token curto ────────────────────────────────────────────────
    // Form-encoded e POST: este endpoint não aceita query string.
    const form = new FormData();
    form.append('client_id',     appId);
    form.append('client_secret', appSecret);
    form.append('grant_type',    'authorization_code');
    form.append('redirect_uri',  redirectUri);
    form.append('code',          code);

    const curtaRes  = await fetch(OAUTH_TOKEN, { method: 'POST', body: form });
    const curtaTxt  = await curtaRes.text();
    if (!curtaRes.ok) {
      marcar('trocar code por token', false, limpar(curtaTxt));
      return json({
        error: 'A Meta recusou a autorização. Se você já tinha usado este link uma vez, '
             + 'refaça a conexão do começo — o código só vale uma vez.',
        etapas,
      }, 502);
    }
    const curta = JSON.parse(curtaTxt) as { access_token?: string; user_id?: number | string };
    const tokenCurto = String(curta?.access_token ?? '');
    const idDoToken  = String(curta?.user_id ?? '');
    if (!tokenCurto) {
      marcar('trocar code por token', false, 'resposta sem access_token');
      return json({ error: 'A Meta não devolveu o token de acesso.', etapas }, 502);
    }
    marcar('trocar code por token', true);

    // ── 3. token curto → token longo (60 dias) ───────────────────────────────
    const longaRes = await fetch(
      `${GRAPH}/access_token?grant_type=ig_exchange_token`
      + `&client_secret=${encodeURIComponent(appSecret)}`
      + `&access_token=${encodeURIComponent(tokenCurto)}`,
    );
    const longaTxt = await longaRes.text();
    if (!longaRes.ok) {
      marcar('trocar por token de 60 dias', false, limpar(longaTxt));
      return json({ error: 'Não consegui obter o token de longa duração.', etapas }, 502);
    }
    const longa = JSON.parse(longaTxt) as { access_token?: string; expires_in?: number };
    const token = String(longa?.access_token ?? '');
    if (!token) {
      marcar('trocar por token de 60 dias', false, 'resposta sem access_token');
      return json({ error: 'A Meta não devolveu o token de longa duração.', etapas }, 502);
    }
    // Sem expires_in, assume 60 dias — o padrão documentado. Melhor uma data
    // aproximada que nenhuma: sem data, o cron de renovação não enxerga a conta.
    const segundos = Number(longa?.expires_in ?? 60 * 24 * 3600);
    const expiraEm = new Date(Date.now() + segundos * 1000);
    marcar('trocar por token de 60 dias', true, `vence em ${expiraEm.toLocaleDateString('pt-BR')}`);

    // ── 4. O ID que o webhook realmente usa ──────────────────────────────────
    const meRes = await fetch(
      `${GRAPH}/${GRAPH_VER}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`,
    );
    const meTxt = await meRes.text();
    if (!meRes.ok) {
      marcar('descobrir a conta', false, limpar(meTxt));
      return json({ error: 'Conectei, mas não consegui identificar a conta do Instagram.', etapas }, 502);
    }
    const me = JSON.parse(meTxt) as { user_id?: number | string; username?: string; id?: string };
    const igUserId = String(me?.user_id ?? '');
    const username = String(me?.username ?? '');
    if (!igUserId) {
      marcar('descobrir a conta', false, 'resposta sem user_id');
      return json({
        error: 'A Meta não devolveu o ID da conta. Sem ele o webhook não acha a loja.',
        etapas,
      }, 502);
    }
    // A divergência é ESPERADA e é justamente o ponto: o id do token é de escopo
    // de aplicativo, o do /me é o da conta profissional. Registrada para que,
    // se um dia a Meta unificar os dois, a mudança apareça no log em vez de
    // virar mistério.
    marcar('descobrir a conta', true,
      `@${username || 'sem-username'} · id ${igUserId}`
      + (idDoToken && idDoToken !== igUserId ? ` (o do token era outro: ${idDoToken})` : ''));

    // ── 5. Assinar o webhook ─────────────────────────────────────────────────
    // Aborta se falhar. Conectar sem webhook é conectar quebrado: a tela diria
    // "conectado" e nenhuma mensagem chegaria — o pior defeito possível, porque
    // não dá erro, só silêncio.
    const subRes = await fetch(
      `${GRAPH}/${GRAPH_VER}/${igUserId}/subscribed_apps?subscribed_fields=messages`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    );
    if (!subRes.ok) {
      marcar('assinar o webhook', false, limpar(await subRes.text()));
      return json({
        error: 'Autorizei na Meta, mas não consegui assinar o webhook — as mensagens não chegariam. '
             + 'Nada foi alterado: a conexão anterior continua valendo.',
        etapas,
      }, 502);
    }
    marcar('assinar o webhook', true);

    // ── 6. Só agora grava ────────────────────────────────────────────────────
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: vaultErr } = await admin.rpc('set_meta_page_token', {
      p_user_id: user.id,
      p_canal:   'instagram',
      p_token:   token,
    });
    if (vaultErr) {
      marcar('guardar o token', false, vaultErr.message);
      return json({ error: 'Conectei na Meta mas falhei ao guardar o token com segurança.', etapas }, 500);
    }
    marcar('guardar o token', true);

    const { error: cfgErr } = await admin
      .from('company_settings')
      .update({
        ig_user_id:         igUserId,
        ig_username:        username || null,
        ig_token_expira_em: expiraEm.toISOString(),
        updated_at:         new Date().toISOString(),
      })
      .eq('user_id', user.id);
    if (cfgErr) {
      marcar('salvar a conta', false, cfgErr.message);
      return json({
        error: 'Token guardado, mas falhei ao salvar o ID da conta — o bot não acharia a loja.',
        etapas,
      }, 500);
    }
    marcar('salvar a conta', true);

    // O token nunca volta na resposta.
    return json({ success: true, ig_user_id: igUserId, username, expira_em: expiraEm.toISOString(), etapas });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[conectar-ig] exceção:', msg);
    return json({ error: msg, etapas }, 500);
  }
});
