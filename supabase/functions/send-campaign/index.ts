import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { sendWhatsAppTemplate } from '../_shared/sendTemplate.ts';

import { buildCors } from '../_shared/cors.ts';

// Rate limit: ~1s entre envios pra não estourar o limite da Meta
const DELAY_BETWEEN_SENDS_MS = 1100;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;
interface Recipient { phone: string; name?: string | null; lead_id?: string | null; }

serve(async (req) => {
  const corsHeaders = buildCors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { campaign_id } = await req.json();
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: 'campaign_id obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const whatsappToken = Deno.env.get('WHATSAPP_TOKEN');
    if (!whatsappToken) {
      return new Response(JSON.stringify({ error: 'WHATSAPP_TOKEN não configurado nas Edge Function Secrets' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Campanha + template
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .select('*, template:template_id(*)')
      .eq('id', campaign_id)
      .single();

    if (campErr || !campaign) {
      return new Response(JSON.stringify({ error: 'Campanha não encontrada' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (campaign.template?.status !== 'approved') {
      return new Response(JSON.stringify({ error: 'Template não aprovado pela Meta', status: campaign.template?.status }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Phone Number ID vem de company_settings (multi-tenant)
    const { data: settings } = await supabase
      .from('company_settings')
      .select('whatsapp_phone_number_id')
      .eq('user_id', campaign.user_id)
      .single();

    const phoneNumberId = String(settings?.whatsapp_phone_number_id ?? '');
    if (!phoneNumberId) {
      return new Response(JSON.stringify({ error: 'whatsapp_phone_number_id não configurado' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const recipients = await resolveAudience(supabase, campaign);

    if (recipients.length === 0) {
      await supabase.from('campaigns')
        .update({ status: 'completed', recipients_count: 0, completed_at: new Date().toISOString() })
        .eq('id', campaign_id);
      return new Response(JSON.stringify({ message: 'Nenhum destinatário', sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabase.from('campaigns')
      .update({ status: 'sending', started_at: new Date().toISOString(), recipients_count: recipients.length })
      .eq('id', campaign_id);

    const sendsRows = recipients.map((r) => ({
      campaign_id, customer_phone: r.phone, customer_name: r.name ?? null, lead_id: r.lead_id ?? null, status: 'pending',
    }));
    const { data: sends } = await supabase.from('campaign_sends').insert(sendsRows).select('id, customer_phone');

    let sentCount = 0;
    let failedCount = 0;

    for (const send of sends ?? []) {
      try {
        const recipient = recipients.find((r) => r.phone === send.customer_phone);
        const bodyParameters = buildTemplateParameters(campaign.template_variables, recipient);

        const result = await sendWhatsAppTemplate({
          phone: send.customer_phone,
          templateName: campaign.template.meta_template_name,
          language: campaign.template.language,
          bodyParameters,
          phoneNumberId,
          token: whatsappToken,
        });

        await supabase.from('campaign_sends')
          .update({ status: 'sent', whatsapp_message_id: result.messageId, sent_at: new Date().toISOString() })
          .eq('id', send.id);
        sentCount++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[send-campaign] erro pra ${send.customer_phone}:`, msg);
        await supabase.from('campaign_sends')
          .update({ status: 'failed', error_message: msg, failed_at: new Date().toISOString() })
          .eq('id', send.id);
        failedCount++;
      }
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_SENDS_MS));
    }

    await supabase.from('campaigns')
      .update({ status: 'completed', sent_count: sentCount, failed_count: failedCount, completed_at: new Date().toISOString() })
      .eq('id', campaign_id);

    return new Response(JSON.stringify({ success: true, sent: sentCount, failed: failedCount, total: recipients.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[send-campaign] exception:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function resolveAudience(supabase: DB, campaign: DB): Promise<Recipient[]> {
  const filter = campaign.audience_filter ?? {};
  const uid = campaign.user_id;
  const mapLeads = (data: DB[]) => (data ?? []).map((l) => ({ phone: l.phone, name: l.name, lead_id: l.id }));

  switch (campaign.audience_type) {
    case 'all_leads': {
      const { data } = await supabase.from('leads').select('id, name, phone').eq('user_id', uid).not('phone', 'is', null);
      return mapLeads(data);
    }
    case 'leads_by_status': {
      const statuses = filter.statuses ?? [];
      const { data } = await supabase.from('leads').select('id, name, phone').eq('user_id', uid).in('status', statuses).not('phone', 'is', null);
      return mapLeads(data);
    }
    case 'leads_inactive': {
      const days = filter.days_inactive ?? 30;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const { data } = await supabase.from('leads').select('id, name, phone').eq('user_id', uid).lt('updated_at', cutoff).not('phone', 'is', null);
      return mapLeads(data);
    }
    case 'leads_by_interest_vehicle': {
      const model = filter.model ?? '';
      const { data } = await supabase.from('vehicle_interests')
        .select('customer_phone, customer_name, lead_id')
        .eq('user_id', uid).eq('status', 'active').ilike('model', `%${model}%`);
      return (data ?? []).map((v: DB) => ({ phone: v.customer_phone, name: v.customer_name, lead_id: v.lead_id }));
    }
    case 'custom_phones': {
      const phones = filter.phones ?? [];
      return phones.map((p: string) => ({ phone: String(p).replace(/\D/g, '') })).filter((r: Recipient) => r.phone);
    }
    default:
      return [];
  }
}

function buildTemplateParameters(templateVars: DB, recipient: DB): { type: string; text: string }[] {
  const params: { type: string; text: string }[] = [];
  if (!templateVars) return params;
  const keys = Object.keys(templateVars).sort((a, b) => parseInt(a) - parseInt(b));
  for (const key of keys) {
    let value = templateVars[key];
    if (typeof value === 'string') {
      const fullName = recipient?.name ?? 'cliente';
      value = value
        .replace(/\{\{nome_cliente\}\}/g, fullName)
        .replace(/\{\{primeiro_nome\}\}/g, String(fullName).split(' ')[0]);
    }
    params.push({ type: 'text', text: String(value) });
  }
  return params;
}
