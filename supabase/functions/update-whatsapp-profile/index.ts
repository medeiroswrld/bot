import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

import { buildCors } from '../_shared/cors.ts';
import { resolveWhatsAppToken } from '../_shared/whatsapp.ts';

const GRAPH = 'https://graph.facebook.com/v25.0';

/**
 * Descobre a QUAL app o WHATSAPP_TOKEN pertence.
 *
 * O endpoint /{app-id}/uploads da Meta não aceita um app qualquer: tem que ser
 * o app que emitiu o token. Quando o META_APP_ID configurado aponta pra outro
 * app — ou quando alguém salvou ali o WABA ID / Business ID por engano — o
 * Graph devolve "Object with ID '...' does not exist, cannot be loaded due to
 * missing permissions" (code 100, subcode 33), que não diz nada sobre a causa
 * real e manda o dev caçar permissão que não é o problema.
 *
 * Então perguntamos pro próprio token de quem ele é: é a única fonte que
 * concorda com o que o /uploads exige.
 */
const ESCOPO_PERFIL = 'whatsapp_business_management';

async function inspecionarToken(token: string, appIdConfigurado: string) {
  try {
    const r = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
    );
    const j = await r.json() as { data?: { app_id?: string; scopes?: string[]; type?: string } };
    const doToken = String(j?.data?.app_id ?? '');
    const scopes  = j?.data?.scopes ?? [];

    if (doToken && doToken !== '0') {
      const divergente = appIdConfigurado && appIdConfigurado !== doToken;
      return {
        appId: doToken,
        scopes,
        conhecido: true,
        aviso: divergente
          ? `META_APP_ID está como ${appIdConfigurado}, mas o WHATSAPP_TOKEN foi emitido pelo app ${doToken}. Usei ${doToken} (é o que o upload exige). Corrija o secret META_APP_ID pra ${doToken}.`
          : undefined,
      };
    }
  } catch (_) {
    // debug_token indisponível — cai no valor configurado e deixa o Graph falar.
  }
  return { appId: appIdConfigurado, scopes: [] as string[], conhecido: false, aviso: undefined };
}

/**
 * Descobre por que a Meta recusou o phone_number_id.
 *
 * O Graph responde 100/33 ("does not exist, cannot be loaded due to missing
 * permissions") tanto pra ID errado quanto pra token sem escopo — e o mesmo ID
 * que funciona em /messages pode ser recusado em /whatsapp_business_profile,
 * porque enviar mensagem usa whatsapp_business_messaging e mexer no perfil
 * exige whatsapp_business_management. Listar os números da WABA separa os dois
 * casos: se o ID configurado está na lista, o problema é permissão.
 */
async function diagnosticarPhoneNumberId(
  token: string, wabaId: string, phoneNumberId: string, scopes: string[], tokenConhecido: boolean,
) {
  if (tokenConhecido && scopes.length > 0 && !scopes.includes(ESCOPO_PERFIL)) {
    return `O WHATSAPP_TOKEN não tem a permissão ${ESCOPO_PERFIL} — ela é obrigatória pra alterar o perfil, e é diferente da whatsapp_business_messaging que o bot usa pra enviar mensagem (por isso o envio funciona e o perfil não). Escopos atuais do token: ${scopes.join(', ') || 'nenhum'}. Gere um token novo incluindo ${ESCOPO_PERFIL}.`;
  }

  if (!wabaId) {
    return `Não dá pra confirmar se ${phoneNumberId} é o Phone Number ID certo porque o WABA ID não está preenchido em Configurações. As duas causas prováveis são: o ID não pertence a essa conta, ou o token não tem a permissão ${ESCOPO_PERFIL}.`;
  }

  try {
    const r = await fetch(`${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json() as {
      data?: Array<{ id?: string; display_phone_number?: string }>;
      error?: { message?: string };
    };

    if (!r.ok || !Array.isArray(j.data)) {
      return `Também não consegui listar os números da WABA ${wabaId} (${j?.error?.message ?? 'sem detalhe'}) — o mais provável é o token não ter a permissão ${ESCOPO_PERFIL}.`;
    }

    const encontrado = j.data.some((n) => String(n.id) === phoneNumberId);
    if (encontrado) {
      return `O ID ${phoneNumberId} EXISTE nessa WABA, então não é ID errado: falta permissão. Confirme que o token tem ${ESCOPO_PERFIL} e que o usuário do sistema tem a WABA nos Ativos dele.`;
    }
    const validos = j.data.map((n) => `${n.id} (${n.display_phone_number ?? 'sem número'})`).join(', ');
    return `O ID ${phoneNumberId} NÃO está na WABA ${wabaId}. Os números válidos dessa conta são: ${validos || 'nenhum'}. Corrija o Phone Number ID em Configurações.`;
  } catch (e) {
    return `Falha ao checar os números da WABA: ${e instanceof Error ? e.message : String(e)}`;
  }
}

serve(async (req) => {
  const corsHeaders = buildCors(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Autentica o usuário via JWT do Supabase
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase    = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verifica o JWT e obtém o user_id
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !user) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    const body = await req.json() as { photo_url?: string; about?: string };
    const { photo_url, about } = body;

    // Carrega configurações da concessionária
    const { data: settings } = await supabase
      .from('company_settings')
      .select('whatsapp_phone_number_id, whatsapp_business_account_id')
      .eq('user_id', user.id)
      .single();

    const phoneNumberId = String(settings?.whatsapp_phone_number_id ?? '');
    const wabaId        = String(settings?.whatsapp_business_account_id ?? '');
    if (!phoneNumberId) {
      return new Response(
        JSON.stringify({ error: 'whatsapp_phone_number_id não configurado em Configurações.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Token DO TENANT (Vault), com o global só como fallback — igual ao resto das
    // functions. Esta aqui tinha ficado no WHATSAPP_TOKEN global, que é de outro
    // negócio: ele até criava a sessão de upload (isso é no app, não na conta),
    // mas não enxergava nem a WABA nem o phone_number_id da loja, e a Meta
    // devolvia "does not exist" como se o ID estivesse errado.
    const waToken = await resolveWhatsAppToken(supabase, user.id);
    if (!waToken) {
      return new Response(
        JSON.stringify({ error: 'Nenhum token do WhatsApp disponível: nem o desta conta (Configurações) nem o secret WHATSAPP_TOKEN.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Uma inspeção só do token serve aos dois passos: o upload precisa do app
    // que o emitiu, e a atualização do perfil precisa do escopo de management.
    const { appId, scopes, conhecido, aviso } = await inspecionarToken(
      waToken, Deno.env.get('META_APP_ID') ?? '',
    );
    if (aviso) console.warn('[update-whatsapp-profile]', aviso);

    let fileHandle: string | undefined;

    // 1. Foto → Resumable Upload API (3 passos exigidos pela Meta para profile picture)
    if (photo_url) {
      if (!appId) {
        return new Response(
          JSON.stringify({
            error: 'Não consegui identificar o App ID da Meta: o secret META_APP_ID está vazio e o WHATSAPP_TOKEN não informou a qual app pertence. Configure META_APP_ID nos Secrets do Supabase com o ID que aparece no painel do app (developers.facebook.com → seu app → Configurações).',
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // a) Baixa a imagem do Supabase Storage
      const imgRes = await fetch(photo_url);
      if (!imgRes.ok) throw new Error('Falha ao baixar imagem do Storage');
      const imgBytes   = await imgRes.arrayBuffer();
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';

      // b) Cria sessão de upload (retorna { "id": "upload:..." })
      const createRes = await fetch(
        `${GRAPH}/${appId}/uploads?file_length=${imgBytes.byteLength}&file_type=${encodeURIComponent(contentType)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${waToken}` },
        },
      );
      if (!createRes.ok) {
        const errBody = await createRes.text();
        // Traduz o erro genérico da Meta pra causa que ele realmente costuma ter.
        const semPermissao = /does not exist|missing permissions/i.test(errBody);
        const faltaEscopo  = scopes.length > 0 && !scopes.includes('whatsapp_business_management');
        const pistas = [
          aviso,
          semPermissao && !aviso
            ? `O app ${appId} recusou o upload. Confirme no developers.facebook.com que esse é o App ID correto e que o usuário do sistema dono do WHATSAPP_TOKEN tem acesso a ele em Business Settings → Usuários do sistema → Ativos.`
            : null,
          faltaEscopo
            ? `O token não tem a permissão whatsapp_business_management (escopos atuais: ${scopes.join(', ')}). Gere um token novo com essa permissão.`
            : null,
        ].filter(Boolean).join(' ');
        throw new Error(`Criação de sessão de upload falhou${pistas ? ` — ${pistas}` : ''}: ${errBody}`);
      }
      const { id: uploadId } = await createRes.json() as { id: string };

      // c) Envia os bytes da imagem (retorna { "h": "..." } — esse é o handle real)
      const uploadRes = await fetch(
        `${GRAPH}/${uploadId}`,
        {
          method: 'POST',
          headers: {
            Authorization: `OAuth ${waToken}`,
            'file_offset': '0',
            'Content-Type': contentType,
          },
          body: new Uint8Array(imgBytes),
        },
      );
      if (!uploadRes.ok) {
        const errBody = await uploadRes.text();
        throw new Error(`Upload de bytes falhou: ${errBody}`);
      }
      const { h: handle } = await uploadRes.json() as { h: string };
      fileHandle = handle;
    }

    // 2. Atualiza o perfil do WhatsApp Business
    const profilePayload: Record<string, unknown> = { messaging_product: 'whatsapp' };
    if (about !== undefined && about !== null) profilePayload.about = about;
    if (fileHandle) profilePayload.profile_picture_handle = fileHandle;

    const profileRes = await fetch(
      `https://graph.facebook.com/v25.0/${phoneNumberId}/whatsapp_business_profile`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${waToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(profilePayload),
      },
    );

    if (!profileRes.ok) {
      const errBody = await profileRes.text();
      const pista = await diagnosticarPhoneNumberId(waToken, wabaId, phoneNumberId, scopes, conhecido);
      console.error('[update-whatsapp-profile] perfil recusado', { phoneNumberId, wabaId, pista });
      throw new Error(`Atualização do perfil falhou — ${pista} (resposta da Meta: ${errBody})`);
    }

    return new Response(
      JSON.stringify({ sucesso: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[update-whatsapp-profile]', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
