import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { sendWhatsAppTemplate } from '../_shared/sendTemplate.ts';
import { resolveWhatsAppToken } from '../_shared/whatsapp.ts';
import { maskPhone } from '../_shared/maskPII.ts';

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

    const token = await resolveWhatsAppToken(supabase, campaign.user_id);

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
          token,
        });

        await supabase.from('campaign_sends')
          .update({ status: 'sent', whatsapp_message_id: result.messageId, sent_at: new Date().toISOString() })
          .eq('id', send.id);

        // Registra o disparo na conversa. Sem isso a campanha some do CRM (o
        // lojista não vê o que foi enviado) e, pior, quando o cliente responde
        // o bot começa o papo sem saber o que foi prometido a ele.
        await registrarDisparoNaConversa(supabase, {
          userId: campaign.user_id,
          phone: send.customer_phone,
          name: send.customer_name,
          texto: renderizarCorpo(campaign.template?.body_text, bodyParameters),
        });
        sentCount++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[send-campaign] erro pra ${maskPhone(send.customer_phone)}:`, msg);
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
    // Base antiga importada pelo lojista. Fica separada dos leads que o bot
    // gerou pra dar pra disparar só pra ela — que é o motivo da importação.
    case 'leads_by_source': {
      const sources = filter.sources ?? ['importacao'];
      const { data } = await supabase.from('leads').select('id, name, phone')
        .eq('user_id', uid).in('source', sources).not('phone', 'is', null);
      return mapLeads(data);
    }
    default:
      return [];
  }
}

// Reconstrói o texto que o cliente REALMENTE recebeu, trocando {{1}}, {{2}}…
// pelos valores enviados à Meta — é isso que vai pro histórico da conversa.
function renderizarCorpo(bodyText: string | null | undefined, params: { text: string }[]): string {
  const base = String(bodyText ?? '').trim();
  if (!base) return '[campanha enviada]';
  return base.replace(/\{\{(\d+)\}\}/g, (_m, n) => params[Number(n) - 1]?.text ?? '');
}

async function registrarDisparoNaConversa(
  supabase: DB,
  { userId, phone, name, texto }: { userId: string; phone: string; name?: string | null; texto: string },
) {
  try {
    // Mesmo onConflict do webhook: se a pessoa já tem conversa, reaproveita.
    const { data: conv } = await supabase
      .from('conversations')
      .upsert(
        { user_id: userId, customer_phone: phone, customer_name: name || null, last_message_at: new Date().toISOString() },
        { onConflict: 'user_id,customer_phone' },
      )
      .select('id')
      .single();

    if (conv?.id) {
      await supabase.from('messages').insert({
        conversation_id: conv.id, role: 'bot', content: texto,
      });
    }
  } catch (e) {
    // Registro é acessório: se falhar, o disparo já saiu e não deve ser desfeito.
    console.error('[send-campaign] falha ao registrar disparo na conversa:', e);
  }
}

function buildTemplateParameters(templateVars: DB, recipient: DB): { type: 'text'; text: string }[] {
  const params: { type: 'text'; text: string }[] = [];
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
