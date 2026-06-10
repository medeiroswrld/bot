import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { sendWhatsAppTemplate } from '../_shared/sendTemplate.ts';
import { maskPhone } from '../_shared/maskPII.ts';

import { buildCors } from '../_shared/cors.ts';

serve(async (req) => {
  const corsHeaders = buildCors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
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

    // Data de hoje no fuso de Brasília (dd/MM)
    const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(new Date()).split('/');
    const curDay = Number(parts[0]);
    const curMonth = Number(parts[1]);

    const { data: settingsList } = await supabase
      .from('company_settings')
      .select('user_id, whatsapp_phone_number_id, birthday_template_id, birthday_enabled')
      .eq('birthday_enabled', true)
      .not('birthday_template_id', 'is', null);

    if (!settingsList || settingsList.length === 0) {
      return new Response(JSON.stringify({ message: 'Nenhum user com aniversário ativo' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let totalSent = 0;
    let totalFailed = 0;

    for (const settings of settingsList) {
      const phoneNumberId = String(settings.whatsapp_phone_number_id ?? '');
      if (!phoneNumberId) continue;

      const { data: template } = await supabase
        .from('message_templates')
        .select('*')
        .eq('id', settings.birthday_template_id)
        .eq('status', 'approved')
        .maybeSingle();
      if (!template) continue;

      const { data: leads } = await supabase
        .from('leads')
        .select('id, name, phone, birth_date')
        .eq('user_id', settings.user_id)
        .not('birth_date', 'is', null)
        .not('phone', 'is', null);

      const aniversariantes = (leads ?? []).filter((l: { birth_date: string }) => {
        // birth_date é 'YYYY-MM-DD' — compara mês/dia direto sem timezone
        const [, m, d] = String(l.birth_date).split('-').map(Number);
        return m === curMonth && d === curDay;
      });

      console.log(`[birthday] user ${settings.user_id}: ${aniversariantes.length} aniversariante(s) hoje (${curDay}/${curMonth})`);

      for (const lead of aniversariantes) {
        try {
          const firstName = String(lead.name ?? 'cliente').split(' ')[0];
          await sendWhatsAppTemplate({
            phone: lead.phone,
            templateName: template.meta_template_name,
            language: template.language,
            bodyParameters: [{ type: 'text', text: firstName }],
            phoneNumberId,
            token: whatsappToken,
          });
          totalSent++;
          await new Promise((r) => setTimeout(r, 1100));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[birthday] erro pra ${maskPhone(lead.phone)}:`, msg);
          totalFailed++;
        }
      }
    }

    return new Response(JSON.stringify({ sent: totalSent, failed: totalFailed, date: `${curDay}/${curMonth}` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[send-birthday] exception:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
