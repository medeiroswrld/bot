import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const WABA_ID = '1284569480545489';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
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

    if (template.status !== 'draft' && template.status !== 'rejected') {
      return new Response(JSON.stringify({ error: `Template já está em status ${template.status}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: settings } = await supabase
      .from('company_settings')
      .select('whatsapp_token')
      .eq('user_id', template.user_id)
      .single();

    if (!settings?.whatsapp_token) {
      return new Response(JSON.stringify({ error: 'Token WhatsApp não configurado' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

    const metaUrl = `https://graph.facebook.com/v25.0/${WABA_ID}/message_templates`;
    const metaPayload = {
      name: template.meta_template_name,
      category: template.category,
      language: template.language,
      components,
    };
    console.log('[submit-template] payload:', JSON.stringify(metaPayload));

    const metaResponse = await fetch(metaUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.whatsapp_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(metaPayload),
    });
    const metaResult = await metaResponse.json();
    console.log('[submit-template] meta response:', JSON.stringify(metaResult));

    if (!metaResponse.ok) {
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
