import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { buildCors } from '../_shared/cors.ts';
import { resolveWhatsAppToken } from '../_shared/whatsapp.ts';

// Rate limit in-memory (por instância) — suficiente para evitar spam à Meta.
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minuto
const RATE_LIMIT_MAX = 5;

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
      components.push({ type: 'HEADER', format: template.header_type });
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
      .select('whatsapp_business_account_id')
      .eq('user_id', template.user_id)
      .maybeSingle();
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
