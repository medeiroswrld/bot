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
    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: pendingTemplates } = await supabase
      .from('message_templates')
      .select('*')
      .eq('user_id', user_id)
      .eq('status', 'pending');

    if (!pendingTemplates || pendingTemplates.length === 0) {
      return new Response(JSON.stringify({ updated: 0, message: 'Nenhum template pendente' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: settings } = await supabase
      .from('company_settings')
      .select('whatsapp_token')
      .eq('user_id', user_id)
      .single();

    if (!settings?.whatsapp_token) {
      return new Response(JSON.stringify({ error: 'Token não configurado' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = `https://graph.facebook.com/v25.0/${WABA_ID}/message_templates?limit=200`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${settings.whatsapp_token}` } });
    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'Erro ao consultar Meta', details: data }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const remoteList = Array.isArray(data.data) ? data.data : [];
    let updated = 0;

    for (const local of pendingTemplates) {
      const remote = remoteList.find((t: { name?: string }) => t.name === local.meta_template_name);
      if (!remote) {
        await supabase.from('message_templates')
          .update({ last_status_check: new Date().toISOString() })
          .eq('id', local.id);
        continue;
      }

      const metaStatus = String(remote.status ?? '').toLowerCase();
      let newStatus = local.status;
      if (metaStatus === 'approved') newStatus = 'approved';
      else if (metaStatus === 'rejected') newStatus = 'rejected';
      else if (metaStatus === 'paused') newStatus = 'paused';
      else if (metaStatus === 'disabled') newStatus = 'disabled';

      if (newStatus !== local.status) {
        await supabase.from('message_templates')
          .update({
            status: newStatus,
            meta_template_id: remote.id ?? local.meta_template_id,
            ...(newStatus === 'approved' ? { approved_at: new Date().toISOString() } : {}),
            ...(newStatus === 'rejected' ? { rejection_reason: remote.rejected_reason ?? 'Não informado' } : {}),
            last_status_check: new Date().toISOString(),
          })
          .eq('id', local.id);
        updated++;
      } else {
        await supabase.from('message_templates')
          .update({ last_status_check: new Date().toISOString() })
          .eq('id', local.id);
      }
    }

    return new Response(JSON.stringify({ updated, total_pending: pendingTemplates.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[check-template-status] exception:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
