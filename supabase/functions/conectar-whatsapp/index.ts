import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { buildCors } from '../_shared/cors.ts';

// Embedded Signup — recebe o resultado do fluxo da Meta e conecta o WhatsApp
// do lojista ao tenant dele.
//
// O `code` que chega aqui vive 30 SEGUNDOS. Por isso o frontend manda direto,
// sem tela intermediária: qualquer confirmação no meio queima o prazo.

const GRAPH = 'https://graph.facebook.com/v25.0';

serve(async (req) => {
  const corsHeaders = buildCors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  // Relatório por etapa: se falhar no meio, a resposta e o log mostram ONDE,
  // em vez de deixar o lojista com um "não funcionou" genérico.
  const etapas: Array<{ etapa: string; ok: boolean; detalhe?: string }> = [];
  const marcar = (etapa: string, ok: boolean, detalhe?: string) => {
    etapas.push({ etapa, ok, detalhe });
    console.log(`[conectar] ${ok ? 'OK ' : 'FALHA'} ${etapa}${detalhe ? ' — ' + detalhe : ''}`);
  };

  try {
    if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

    // 1. Quem é o usuário — pelo JWT, NUNCA pelo body. Se viesse do body,
    //    qualquer usuário logado conectaria um WhatsApp na conta de outro.
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authorization ausente' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userErr } =
      await userClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userErr || !user) return json({ error: 'Não autenticado' }, 401);

    // 2. Body vindo do Embedded Signup
    let body: { code?: string; waba_id?: string; phone_number_id?: string; pin?: string };
    try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

    const code    = String(body?.code ?? '').trim();
    const wabaId  = String(body?.waba_id ?? '').trim();
    const phoneId = String(body?.phone_number_id ?? '').trim();
    const pin     = String(body?.pin ?? '').trim();

    if (!code)    return json({ error: 'code ausente (o Embedded Signup não concluiu).' }, 400);
    if (!wabaId)  return json({ error: 'waba_id ausente.' }, 400);
    if (!phoneId) return json({ error: 'phone_number_id ausente.' }, 400);

    const appId     = Deno.env.get('META_APP_ID') ?? '';
    const appSecret = Deno.env.get('WHATSAPP_APP_SECRET') ?? '';
    if (!appId || !appSecret) {
      return json({ error: 'META_APP_ID ou WHATSAPP_APP_SECRET não configurados nos Secrets.' }, 500);
    }

    // 3. Troca o code pelo token DO CLIENTE.
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token`
      + `?client_id=${encodeURIComponent(appId)}`
      + `&client_secret=${encodeURIComponent(appSecret)}`
      + `&code=${encodeURIComponent(code)}`,
    );
    const tokenBody = await tokenRes.text();
    if (!tokenRes.ok) {
      marcar('trocar code por token', false, tokenBody.slice(0, 200));
      return json({
        error: 'Não consegui concluir a conexão com a Meta. Se demorou mais de 30 segundos entre autorizar e voltar, refaça o processo.',
        etapas,
      }, 502);
    }
    const accessToken = String((JSON.parse(tokenBody) as { access_token?: string })?.access_token ?? '');
    if (!accessToken) {
      marcar('trocar code por token', false, 'resposta sem access_token');
      return json({ error: 'A Meta não devolveu o token de acesso.', etapas }, 502);
    }
    marcar('trocar code por token', true);

    // 4. Assina o webhook na WABA do cliente. Sem isto NENHUMA mensagem chega —
    //    é a única etapa da Graph que aborta, porque conectar sem webhook é
    //    conectar quebrado.
    const subRes = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!subRes.ok) {
      marcar('assinar webhook na WABA', false, (await subRes.text()).slice(0, 200));
      return json({
        error: 'Conectei à conta, mas não consegui assinar o webhook — as mensagens não chegariam.',
        etapas,
      }, 502);
    }
    marcar('assinar webhook na WABA', true);

    // 5. Registro do número — NÃO aborta.
    //    Número que já está na Cloud API (o caso da migração com coexistência)
    //    responde erro aqui, e isso é esperado.
    //    Só tenta com PIN informado: inventar um mudaria a verificação em duas
    //    etapas do cliente sem ele saber.
    if (pin) {
      const regRes = await fetch(`${GRAPH}/${phoneId}/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
      });
      marcar('registrar número', regRes.ok, regRes.ok ? undefined : (await regRes.text()).slice(0, 200));
    } else {
      marcar('registrar número', true, 'pulado (sem PIN) — número já registrado segue funcionando');
    }

    // 6. Token cifrado no Vault. Mesma RPC usada pelo set-whatsapp-token.
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: vaultErr } = await admin.rpc('set_whatsapp_token', {
      p_user_id: user.id,
      p_token:   accessToken,
    });
    if (vaultErr) {
      marcar('guardar token', false, vaultErr.message);
      return json({ error: 'Conectei na Meta mas falhei ao guardar o token com segurança.', etapas }, 500);
    }
    marcar('guardar token', true);

    // 7. Ids no company_settings do usuário do JWT.
    //    whatsapp_phone_number_id é o ID da Cloud API — é por ele que o webhook
    //    descobre de qual loja é cada mensagem. Não confundir com phone_number,
    //    que é o telefone da loja em texto, usado no prompt do bot.
    // A loja pode ter VÁRIOS números (083). Grava na tabela de números, que é
    // por onde o webhook roteia desde então.
    //
    // O primeiro número conectado vira o principal; os seguintes entram como
    // adicionais. Sem esse cuidado, conectar o segundo número sobrescreveria o
    // primeiro em company_settings e as conversas dele parariam de chegar — sem
    // erro em lugar nenhum.
    const { count: jaTem } = await admin
      .from('whatsapp_numbers')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('ativo', true);

    const ehPrimeiro = !jaTem;

    const { error: numErr } = await admin
      .from('whatsapp_numbers')
      .upsert(
        {
          user_id: user.id,
          phone_number_id: phoneId,
          waba_id: wabaId,
          principal: ehPrimeiro,
          ativo: true,
        },
        { onConflict: 'phone_number_id' },
      );

    if (numErr) {
      // Migration 083 ainda não rodou: segue pelo caminho antigo em vez de
      // impedir a conexão. Um número conectado é melhor que nenhum.
      console.warn('[conectar] whatsapp_numbers indisponível, usando só company_settings:', numErr.message);
    }

    // company_settings continua sendo atualizado: seis funções ainda leem
    // daqui, e o trigger da 083 mantém isto igual ao número principal. Só
    // escreve quando for o principal, pra não trocar o padrão da loja sem
    // querer ao conectar um número secundário.
    const { error: cfgErr } = await admin
      .from('company_settings')
      .update({
        ...(ehPrimeiro || numErr ? { whatsapp_phone_number_id: phoneId } : {}),
        whatsapp_business_account_id: wabaId,
      })
      .eq('user_id', user.id);
    if (cfgErr) {
      marcar('salvar números da conta', false, cfgErr.message);
      return json({ error: 'Token guardado, mas falhei ao salvar os identificadores da conta.', etapas }, 500);
    }
    marcar('salvar números da conta', true);

    // O token nunca volta na resposta.
    return json({ success: true, phone_number_id: phoneId, waba_id: wabaId, etapas });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[conectar] exceção:', msg);
    return json({ error: msg, etapas }, 500);
  }
});
