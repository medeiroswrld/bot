import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { sendWhatsAppTemplate } from '../_shared/sendTemplate.ts';

import { buildCors } from '../_shared/cors.ts';

const fmtBRL = (n: number) => `R$ ${Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
const fmtKm  = (n: number) => `${Number(n || 0).toLocaleString('pt-BR')} km`;

serve(async (req) => {
  const corsHeaders = buildCors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { car_id, interest_ids } = await req.json();
    if (!car_id || !Array.isArray(interest_ids) || interest_ids.length === 0) {
      return new Response(JSON.stringify({ error: 'car_id e interest_ids[] obrigatórios' }), {
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

    // Carro
    const { data: car } = await supabase.from('cars').select('*').eq('id', car_id).single();
    if (!car) {
      return new Response(JSON.stringify({ error: 'Carro não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const carName = [car.brand, car.model, car.version].filter(Boolean).join(' ');
    const carDescription = `${carName} ${car.year}, ${fmtKm(car.mileage)}, ${fmtBRL(car.price)}`;

    // Settings (template + phone + nome empresa) da empresa dona do carro
    const { data: settings } = await supabase
      .from('company_settings')
      .select('whatsapp_phone_number_id, waiting_list_template_id, company_name')
      .eq('user_id', car.user_id)
      .single();

    if (!settings?.waiting_list_template_id) {
      return new Response(JSON.stringify({ error: 'Template de Lista de Espera não configurado em Configurações' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const phoneNumberId = String(settings.whatsapp_phone_number_id ?? '');
    if (!phoneNumberId) {
      return new Response(JSON.stringify({ error: 'whatsapp_phone_number_id não configurado' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const companyName = String(settings.company_name ?? 'nossa loja');

    // Template precisa estar aprovado
    const { data: template } = await supabase
      .from('message_templates')
      .select('*')
      .eq('id', settings.waiting_list_template_id)
      .eq('status', 'approved')
      .maybeSingle();

    if (!template) {
      return new Response(JSON.stringify({ error: 'Template ainda não aprovado pela Meta' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Interesses
    const { data: interests } = await supabase
      .from('vehicle_interests')
      .select('*')
      .in('id', interest_ids);

    if (!interests || interests.length === 0) {
      return new Response(JSON.stringify({ error: 'Nenhum interesse encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let sent = 0;
    let failed = 0;

    for (const interest of interests) {
      const firstName = String(interest.customer_name ?? 'cliente').split(' ')[0];
      try {
        console.log('[notify-waiting-list] enviando para', interest.customer_phone, 'modelo:', interest.model);
        await sendWhatsAppTemplate({
          phone: interest.customer_phone,
          templateName: template.meta_template_name,
          language: template.language,
          // 4 variáveis: primeiro_nome, modelo_procurado, nome_empresa, descricao_carro
          bodyParameters: [
            { type: 'text', text: firstName },
            { type: 'text', text: String(interest.model ?? 'veículo') },
            { type: 'text', text: companyName },
            { type: 'text', text: carDescription },
          ],
          phoneNumberId,
          token: whatsappToken,
        });

        await supabase.from('vehicle_interests')
          .update({
            status: 'notified',
            notification_count: (Number(interest.notification_count) || 0) + 1,
            last_notified_at: new Date().toISOString(),
          })
          .eq('id', interest.id);

        console.log('[notify-waiting-list] enviado ok:', interest.id);
        sent++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[notify-waiting-list] erro pra', interest.customer_phone, msg);
        // Não trava os outros — registra o erro nas notes do interesse
        const errLine = `[aviso falhou ${new Date().toISOString()}] ${msg}`.slice(0, 300);
        const newNotes = interest.notes ? `${interest.notes}\n${errLine}` : errLine;
        await supabase.from('vehicle_interests').update({ notes: newNotes }).eq('id', interest.id);
        failed++;
      }
      await new Promise((r) => setTimeout(r, 1100));
    }

    console.log('[notify-waiting-list] concluído:', { sent, failed, car_id });
    return new Response(JSON.stringify({ sent, failed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[notify-waiting-list] exception:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
