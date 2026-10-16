import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { sendWhatsAppTemplate } from '../_shared/sendTemplate.ts';
import { resolveWhatsAppToken } from '../_shared/whatsapp.ts';
import { maskPhone } from '../_shared/maskPII.ts';
import { buildCors } from '../_shared/cors.ts';

/** Data de hoje (ou +N dias) NO FUSO DA LOJA, em AAAA-MM-DD. */
function dataLocal(tz: string, offsetDays = 0): string {
  const iso = new Intl.DateTimeFormat('sv-SE', { timeZone: tz || 'America/Sao_Paulo' }).format(new Date());
  if (offsetDays === 0) return iso;
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + offsetDays);
  return new Intl.DateTimeFormat('sv-SE').format(d);
}

/**
 * Deslocamento do fuso da loja NAQUELE instante, como "-03:00" ou "+01:00".
 *
 * Calculado, e nao uma constante, por causa do horario de verao: o Brasil nao
 * tem desde 2019, mas Portugal e Espanha tem. Um offset fixo acertaria metade
 * do ano e erraria a outra metade — e o erro seria o lembrete chegando uma
 * hora cedo ou tarde, que ninguem associa a fuso.
 */
function offsetDoFuso(tz: string, quando: Date): string {
  const nome = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'America/Sao_Paulo', timeZoneName: 'longOffset',
  }).formatToParts(quando).find((p) => p.type === 'timeZoneName')?.value ?? '';
  const off = nome.replace('GMT', '').trim();
  return off || '+00:00';   // "GMT" puro = UTC
}

function fmtHora(t: string): string {
  const [h, m] = String(t).substring(0, 5).split(':');
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
}

serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  // Tenants com lembrete ativo
  const { data: tenants } = await supabase
    .from('company_settings')
    .select('user_id, visit_reminder_minutes_before, company_name, address, whatsapp_phone_number_id, timezone')
    .eq('visit_reminder_enabled', true);

  if (!tenants?.length) {
    return new Response(JSON.stringify({ message: 'nenhum tenant com lembrete ativo' }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // A data agora e POR LOJA: duas lojas em fusos diferentes podem estar em dias
  // diferentes no mesmo instante. Calcular uma vez para todas faria a loja
  // europeia procurar os agendamentos do dia errado.
  const now = Date.now();
  let processed = 0, sent = 0, failed = 0, skipped = 0;

  for (const t of tenants) {
    const tz = String(t.timezone ?? 'America/Sao_Paulo');
    const today = dataLocal(tz, 0);
    const tomorrow = dataLocal(tz, 1);
    const minutesBefore = Number(t.visit_reminder_minutes_before ?? 15);
    const pid = String(t.whatsapp_phone_number_id ?? '');
    const token = await resolveWhatsAppToken(supabase, t.user_id);
    if (!pid || !token) { console.warn(`[reminder] tenant ${t.user_id} sem phone_number_id/token`); continue; }

    // Template lembrete_visita aprovado para este tenant?
    const { data: tpl } = await supabase
      .from('message_templates')
      .select('meta_template_name, language')
      .eq('user_id', t.user_id)
      .eq('meta_template_name', 'lembrete_visita')
      .eq('status', 'approved')
      .maybeSingle();

    // Candidatos: hoje/amanhã, agendados, sem lembrete ainda
    const { data: appts } = await supabase
      .from('appointments')
      .select('id, customer_name, customer_phone, appointment_date, appointment_time')
      .eq('user_id', t.user_id)
      .in('status', ['scheduled', 'confirmed'])
      .is('reminder_sent_at', null)
      .in('appointment_date', [today, tomorrow]);

    for (const a of (appts ?? [])) {
      const quando = new Date(`${a.appointment_date}T12:00:00Z`);
      const epoch = Date.parse(
        `${a.appointment_date}T${String(a.appointment_time).substring(0, 5)}:00${offsetDoFuso(tz, quando)}`,
      );
      if (isNaN(epoch)) continue;
      const minutesUntil = (epoch - now) / 60000;
      if (minutesUntil < 2 || minutesUntil > minutesBefore) continue; // fora da janela

      // Sem nome → não envia (template ficaria esquisito). Atendente preenche depois.
      if (!a.customer_name || !String(a.customer_name).trim()) {
        console.warn(`[reminder] appt ${a.id} sem nome — lembrete pulado`);
        skipped++;
        continue;
      }
      processed++;

      // Sem template aprovado → marca failed sem claim (re-tenta quando aprovar)
      if (!tpl) {
        await supabase.from('appointments').update({ reminder_status: 'failed' }).eq('id', a.id).is('reminder_sent_at', null);
        console.error(`[reminder] tenant ${t.user_id}: template lembrete_visita não aprovado — appt ${a.id}`);
        failed++;
        continue;
      }

      // Claim atômico: só prossegue quem conseguir marcar reminder_sent_at
      const { data: claimed } = await supabase
        .from('appointments')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', a.id)
        .is('reminder_sent_at', null)
        .select('id')
        .maybeSingle();
      if (!claimed) continue; // outra invocação já pegou

      const nome = String(a.customer_name).split(' ')[0];
      try {
        await sendWhatsAppTemplate({
          phone: a.customer_phone,
          templateName: 'lembrete_visita',
          language: String(tpl.language ?? 'pt_BR'),
          bodyParameters: [
            { type: 'text', text: nome },
            { type: 'text', text: fmtHora(a.appointment_time) },
            { type: 'text', text: String(t.company_name ?? 'nossa loja') },
            { type: 'text', text: String(t.address ?? '') },
          ],
          phoneNumberId: pid,
          token,
        });
        await supabase.from('appointments').update({ reminder_status: 'sent' }).eq('id', a.id);
        sent++;
        console.log(`[reminder] enviado appt ${a.id} (${maskPhone(a.customer_phone)}) ~${Math.round(minutesUntil)}min antes`);
        await new Promise((r) => setTimeout(r, 1100)); // throttle entre envios
      } catch (e) {
        await supabase.from('appointments').update({ reminder_status: 'failed' }).eq('id', a.id);
        failed++;
        console.error(`[reminder] falha appt ${a.id} (${maskPhone(a.customer_phone)}):`, e instanceof Error ? e.message : String(e));
      }
    }
  }

  console.log(`[reminder] resumo: processed=${processed} sent=${sent} failed=${failed} skipped=${skipped}`);
  return new Response(JSON.stringify({ processed, sent, failed, skipped }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
