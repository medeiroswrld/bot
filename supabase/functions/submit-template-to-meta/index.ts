import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { buildCors } from '../_shared/cors.ts';
import { resolveWhatsAppToken } from '../_shared/whatsapp.ts';
import { podeDisparar, COLUNAS_DISPARO } from '../_shared/botGuards.ts';

// Rate limit in-memory (por instância) — suficiente para evitar spam à Meta.
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minuto
const RATE_LIMIT_MAX = 5;

// Tipos que a Resumable Upload API da Meta aceita. Fora desta lista ela recusa
// a sessão, e a mensagem de erro dela não diz qual era o problema.
const TIPOS_ACEITOS = ['image/jpeg', 'image/jpg', 'image/png'];

/**
 * Sobe a imagem de EXEMPLO do cabeçalho e devolve o `header_handle`.
 *
 * Template com cabeçalho de mídia só é aprovado se a submissão trouxer um
 * exemplo, e o exemplo não é uma URL: é um handle que só existe depois de o
 * arquivo passar pela Resumable Upload API. Era isto que faltava aqui — o
 * código antigo mandava `{ type: 'HEADER', format: 'IMAGE' }` sem exemplo, e a
 * Meta rejeitava.
 *
 * São DUAS chamadas, com esquemas de autorização DIFERENTES (documentado, e é
 * o detalhe que falha calado):
 *   1. abre a sessão com `access_token` na QUERY
 *   2. transfere os bytes com `Authorization: OAuth` — NÃO `Bearer`
 *
 * Token: usa o token de APP (`{app_id}|{app_secret}`). O recurso é o próprio
 * app, e no modelo OBO o token do lojista vem do Facebook DELE — não teria
 * acesso ao endpoint de uploads do NOSSO app.
 */
async function subirExemploParaMeta(
  urlDaImagem: string,
): Promise<{ handle: string } | { erro: string }> {
  const appId     = Deno.env.get('META_APP_ID') ?? '';
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET') ?? '';
  if (!appId || !appSecret) {
    return { erro: 'META_APP_ID ou WHATSAPP_APP_SECRET não configurados — sem eles não dá pra subir a imagem de exemplo pra Meta.' };
  }
  const appToken = `${appId}|${appSecret}`;

  // 1. Busca os bytes da imagem (ela vive no Storage do Supabase, pública).
  //    Guardado como ArrayBuffer, e não Uint8Array, porque é ArrayBuffer que o
  //    `fetch` aceita direto em `body` sem cast.
  let buf: ArrayBuffer;
  let tipo: string;
  try {
    const r = await fetch(urlDaImagem);
    if (!r.ok) return { erro: `Não consegui baixar a imagem do cabeçalho (HTTP ${r.status}).` };
    tipo = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    buf = await r.arrayBuffer();
  } catch (e) {
    return { erro: `Falha ao baixar a imagem do cabeçalho: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!TIPOS_ACEITOS.includes(tipo)) {
    return { erro: `A Meta aceita só JPEG e PNG no cabeçalho. Esta imagem é "${tipo || 'tipo desconhecido'}".` };
  }
  if (buf.byteLength === 0) return { erro: 'A imagem do cabeçalho veio vazia.' };

  // 2. Abre a sessão de upload.
  const qs = new URLSearchParams({
    file_name: 'cabecalho',
    file_length: String(buf.byteLength),
    file_type: tipo,
    access_token: appToken,
  });
  let sessionId: string;
  try {
    const r = await fetch(`https://graph.facebook.com/v25.0/${appId}/uploads?${qs}`, { method: 'POST' });
    const j = await r.json();
    if (!r.ok || !j?.id) {
      return { erro: `A Meta recusou abrir a sessão de upload: ${JSON.stringify(j).slice(0, 300)}` };
    }
    sessionId = String(j.id);   // já vem com o prefixo "upload:"
  } catch (e) {
    return { erro: `Erro ao abrir a sessão de upload: ${e instanceof Error ? e.message : String(e)}` };
  }

  // 3. Transfere os bytes. Aqui é `OAuth`, não `Bearer` — com Bearer a chamada
  //    falha e a mensagem não explica por quê.
  try {
    const r = await fetch(`https://graph.facebook.com/v25.0/${sessionId}`, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${appToken}`,
        file_offset: '0',
        'Content-Type': 'application/octet-stream',
      },
      body: buf,
    });
    const j = await r.json();
    if (!r.ok || !j?.h) {
      return { erro: `A Meta recusou a imagem: ${JSON.stringify(j).slice(0, 300)}` };
    }
    return { handle: String(j.h) };
  } catch (e) {
    return { erro: `Erro ao transferir a imagem: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

serve(async (req) => {
  const corsHeaders = buildCors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { template_id } = await req.json();
    if (!template_id) {
      return new Response(JSON.stringify({ error: 'template_id obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: template, error: tplErr } = await supabase
      .from('message_templates')
      .select('*')
      .eq('id', template_id)
      .single();

    if (tplErr || !template) {
      return new Response(JSON.stringify({ error: 'Template não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Rate limit por dono do template (5 submissões/minuto) — evita ban da Meta
    if (!checkRateLimit(String(template.user_id))) {
      return new Response(JSON.stringify({ error: 'Muitas tentativas. Aguarde 1 minuto e tente novamente.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (template.status !== 'draft' && template.status !== 'rejected') {
      return new Response(JSON.stringify({ error: `Template já está em status ${template.status}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const whatsappToken = Deno.env.get('WHATSAPP_TOKEN');
    if (!whatsappToken) {
      return new Response(JSON.stringify({ error: 'WHATSAPP_TOKEN não configurado nas Edge Function Secrets' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Monta componentes no formato Meta
    const components: Array<Record<string, unknown>> = [];

    if (template.header_type === 'TEXT' && template.header_content) {
      components.push({ type: 'HEADER', format: 'TEXT', text: template.header_content });
    } else if (template.header_type && template.header_type !== 'TEXT') {
      // Cabeçalho de mídia precisa de EXEMPLO, e o exemplo é um handle que só
      // nasce do upload. Sem isto a Meta rejeita a submissão.
      const urlExemplo = String(template.header_content ?? '').trim();
      if (!urlExemplo) {
        return new Response(JSON.stringify({
          error: `Este template tem cabeçalho de ${template.header_type} mas nenhuma imagem de exemplo. `
               + 'Envie a imagem na tela de Templates antes de mandar pra aprovação.',
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const r = await subirExemploParaMeta(urlExemplo);
      if ('erro' in r) {
        console.error('[submit-template] upload do exemplo falhou:', r.erro);
        // Erro explícito em vez de submeter sabendo que vai ser rejeitado: uma
        // rejeição da Meta gasta revisão e não diz que o problema era o nosso.
        return new Response(JSON.stringify({ error: r.erro }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log('[submit-template] exemplo do cabeçalho subiu, handle obtido');
      components.push({
        type: 'HEADER',
        format: template.header_type,
        example: { header_handle: [r.handle] },
      });
    }

    const bodyComponent: Record<string, unknown> = { type: 'BODY', text: template.body_text };
    const vars = Array.isArray(template.body_variables) ? template.body_variables : [];
    if (vars.length > 0) {
      bodyComponent.example = {
        body_text: [vars.map((v: { example?: string }) => v.example || 'exemplo')],
      };
    }
    components.push(bodyComponent);

    if (template.footer_text) {
      components.push({ type: 'FOOTER', text: template.footer_text });
    }

    const buttons = Array.isArray(template.buttons) ? template.buttons : [];
    if (buttons.length > 0) {
      components.push({ type: 'BUTTONS', buttons });
    }

    // WABA ID por tenant: lê de company_settings (pelo dono do template); fallback para o secret.
    const { data: wabaSettings } = await supabase
      .from('company_settings')
      .select(`whatsapp_business_account_id, ${COLUNAS_DISPARO}`)
      .eq('user_id', template.user_id)
      .maybeSingle();

    // Template existe pra ser disparado. Sem disparo no plano, submeter a Meta
    // so consome fila de revisao deles pra nada.
    if (!podeDisparar(wabaSettings)) {
      return new Response(JSON.stringify({ error: 'Envio em massa não faz parte do plano desta conta.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const wabaId = String(
      wabaSettings?.whatsapp_business_account_id || Deno.env.get('WHATSAPP_BUSINESS_ACCOUNT_ID') || '',
    ).trim();
    if (!wabaId) {
      return new Response(JSON.stringify({
        error: 'WABA não configurado para esta conta (company_settings.whatsapp_business_account_id ou secret WHATSAPP_BUSINESS_ACCOUNT_ID).',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const tenantToken = await resolveWhatsAppToken(supabase, template.user_id);

    const metaUrl = `https://graph.facebook.com/v25.0/${wabaId}/message_templates`;
    const metaPayload = {
      name: template.meta_template_name,
      category: template.category,
      language: template.language,
      components,
    };
    console.log('[submit-template] payload:', JSON.stringify(metaPayload));

    const metaResponse = await fetch(metaUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tenantToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(metaPayload),
    });
    const metaResult = await metaResponse.json();
    console.log('[submit-template] meta response:', JSON.stringify(metaResult));

    if (!metaResponse.ok) {
      // Subcode 2388024 = "Já existe conteúdo nesse idioma" — o template já existe na Meta.
      // Não é rejeição: buscamos o template existente pelo nome e marcamos como pending
      // pra consultar o status depois (em vez de marcar como rejeitado).
      if (metaResult.error?.error_subcode === 2388024) {
        const listUrl = `https://graph.facebook.com/v25.0/${wabaId}/message_templates`
          + `?name=${encodeURIComponent(template.meta_template_name)}&limit=1`;
        const listResponse = await fetch(listUrl, {
          // tenantToken, nao o global: o WHATSAPP_TOKEN global e de OUTRO
          // negocio e nao enxerga a WABA do cliente. A submissao acima ja usa
          // o do tenant; so este fallback tinha ficado para tras, e ele roda
          // justamente quando o nome ja existe - o caso em que mais importa
          // achar o template certo.
          headers: { Authorization: `Bearer ${tenantToken}` },
        });
        const listResult = await listResponse.json();
        console.log('[submit-template] existing template lookup:', JSON.stringify(listResult));

        const existing = Array.isArray(listResult.data)
          ? listResult.data.find(
              (t: { language?: string }) => t.language === template.language,
            ) ?? listResult.data[0]
          : null;

        if (existing?.id) {
          await supabase.from('message_templates')
            .update({
              meta_template_id: existing.id,
              status: 'pending',
              rejection_reason: null,
              submitted_at: new Date().toISOString(),
            })
            .eq('id', template_id);

          return new Response(JSON.stringify({
            success: true,
            meta_template_id: existing.id,
            status: existing.status || 'PENDING',
            already_existed: true,
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        // Não achou o existente — cai pro fluxo de erro normal abaixo.
      }

      // is_transient = instabilidade da Meta, nao reprovacao do texto. A
      // propria resposta dela diz "Please retry your request later". Gravar
      // 'rejected' aqui mente pro lojista, que vai reescrever um template que
      // nunca teve problema. Volta pra 'draft' pra tentar de novo.
      if (metaResult.error?.is_transient === true) {
        await supabase.from('message_templates')
          .update({ status: 'draft', rejection_reason: null })
          .eq('id', template_id);
        return new Response(JSON.stringify({
          error: 'A Meta está instável no momento e pediu para tentar de novo. Reenvie em alguns minutos — o template não foi reprovado.',
          transient: true,
        }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      await supabase.from('message_templates')
        .update({ status: 'rejected', rejection_reason: JSON.stringify(metaResult.error || metaResult) })
        .eq('id', template_id);
      return new Response(JSON.stringify({ error: 'Meta rejeitou o template', details: metaResult.error || metaResult }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabase.from('message_templates')
      .update({
        meta_template_id: metaResult.id,
        status: 'pending',
        rejection_reason: null,
        submitted_at: new Date().toISOString(),
      })
      .eq('id', template_id);

    return new Response(JSON.stringify({
      success: true,
      meta_template_id: metaResult.id,
      status: metaResult.status || 'PENDING',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[submit-template] exception:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
