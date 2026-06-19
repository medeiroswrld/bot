import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { sendMessage } from '../_shared/whatsapp.ts';
import { maskPhone } from '../_shared/maskPII.ts';
import { buildCors } from '../_shared/cors.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = ReturnType<typeof createClient<any>>;

// NOTA: generateTimeSlots e computeFreeSlots duplicam a lógica do
// process-conversation (ver_horarios_disponiveis). Mantido duplicado de
// propósito para não tocar na function que já roda em produção; extrair para
// _shared/schedule.ts quando estabilizar.
function generateTimeSlots(startTime: string, endTime: string, durationMin: number, intervalMin: number): string[] {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let cur = sh * 60 + sm;
  const end = eh * 60 + em;
  const slots: string[] = [];
  while (cur + durationMin <= end) {
    slots.push(`${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`);
    cur += durationMin + intervalMin;
  }
  return slots;
}

// Disponibilidade real de uma data (mesma regra do ver_horarios_disponiveis)
async function computeFreeSlots(
  supabase: SupabaseClient,
  userId: string,
  dateStr: string,
  settings: Record<string, unknown>,
): Promise<{ closed: boolean; freeSlots: string[] }> {
  const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayKey = DOW[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];

  const { data: exception } = await supabase
    .from('schedule_exceptions')
    .select('closed, start_time, end_time')
    .eq('user_id', userId)
    .eq('date', dateStr)
    .maybeSingle();

  let slotStart: string;
  let slotEnd: string;

  if (exception) {
    if (exception.closed) return { closed: true, freeSlots: [] };
    slotStart = String(exception.start_time ?? '09:00');
    slotEnd = String(exception.end_time ?? '18:00');
  } else {
    type DayHours = { open?: boolean; start?: string; end?: string };
    const bh = settings.business_hours as Record<string, DayHours> | null;
    const dh = bh?.[dayKey];
    if (!dh?.open) {
      if (!bh) {
        const LEGACY: Record<string, string> = { sun: 'Dom', mon: 'Seg', tue: 'Ter', wed: 'Qua', thu: 'Qui', fri: 'Sex', sat: 'Sáb' };
        const wd = String(settings.working_days ?? 'Seg,Ter,Qua,Qui,Sex').split(',').map((s) => s.trim());
        if (!wd.includes(LEGACY[dayKey])) return { closed: true, freeSlots: [] };
        slotStart = String(settings.business_hours_start ?? '09:00');
        slotEnd = String(settings.business_hours_end ?? '18:00');
      } else {
        return { closed: true, freeSlots: [] };
      }
    } else {
      slotStart = dh.start ?? '09:00';
      slotEnd = dh.end ?? '18:00';
    }
  }

  const slots = generateTimeSlots(
    slotStart,
    slotEnd,
    Number(settings.appointment_duration ?? 60),
    Number(settings.appointment_interval ?? 15),
  );
  const maxPerSlot = Number(settings.max_appointments_per_slot ?? 1);

  const { data: appts } = await supabase
    .from('appointments')
    .select('appointment_time')
    .eq('user_id', userId)
    .eq('appointment_date', dateStr)
    .neq('status', 'cancelled');

  const count = new Map<string, number>();
  for (const a of (appts ?? [])) {
    const t = String(a.appointment_time).substring(0, 5);
    count.set(t, (count.get(t) ?? 0) + 1);
  }
  return { closed: false, freeSlots: slots.filter((s) => (count.get(s) ?? 0) < maxPerSlot) };
}

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function nearest(free: string[], target: string, n: number): string[] {
  const t = toMin(target);
  return [...free].sort((a, b) => Math.abs(toMin(a) - t) - Math.abs(toMin(b) - t)).slice(0, n);
}

function fmtWhen(dateStr: string, time: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  const wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(d);
  const dm = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(d);
  const [h, m] = time.split(':');
  const hora = m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
  return `${wd} (${dm}) às ${hora}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return new Intl.DateTimeFormat('sv-SE').format(d); // YYYY-MM-DD
}

serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: convs } = await supabase
    .from('conversations')
    .select('id, user_id, customer_phone, customer_name, status, pending_schedule_check')
    .not('pending_schedule_check', 'is', null);

  let processed = 0, fitted = 0, alts = 0, skipped = 0;

  for (const conv of (convs ?? [])) {
    const pending = conv.pending_schedule_check as
      { requested_datetime: string; requested_at: string; customer_context?: string } | null;
    if (!pending?.requested_datetime || !pending?.requested_at) continue;
    if (conv.status === 'human') { skipped++; continue; }

    const ageMin = (Date.now() - new Date(pending.requested_at).getTime()) / 60000;
    if (ageMin < 3) continue; // ainda dentro do "te respondo em alguns minutos"

    // claim atômico: zera pending; se outro run já zerou, pula (evita resposta dupla)
    const { data: claimed } = await supabase
      .from('conversations')
      .update({ pending_schedule_check: null })
      .eq('id', conv.id)
      .not('pending_schedule_check', 'is', null)
      .select('id')
      .maybeSingle();
    if (!claimed) continue;

    if (ageMin > 30) { // antigo demais (cron ficou fora do ar): limpa sem responder
      console.log(`[pending] ${conv.id} descartado (idade ${ageMin.toFixed(0)}min > 30)`);
      skipped++;
      continue;
    }
    processed++;

    const { data: settings } = await supabase
      .from('company_settings')
      .select('business_hours, working_days, business_hours_start, business_hours_end, appointment_duration, appointment_interval, max_appointments_per_slot, whatsapp_phone_number_id')
      .eq('user_id', conv.user_id)
      .single();
    if (!settings) { console.error(`[pending] ${conv.id}: sem company_settings`); continue; }

    const pid = String(settings.whatsapp_phone_number_id ?? '');
    const nome = conv.customer_name ? String(conv.customer_name).split(' ')[0] : null;
    const greet = nome ? `${nome}, ` : '';

    const [datePart, timeRaw] = String(pending.requested_datetime).split('T');
    const timePart = (timeRaw ?? '').substring(0, 5);

    const { closed, freeSlots } = await computeFreeSlots(supabase, conv.user_id, datePart, settings as Record<string, unknown>);
    const requestedFree = !closed && timePart !== '' && freeSlots.includes(timePart);

    let msg: string;
    if (requestedFree) {
      await supabase.from('appointments').insert({
        user_id: conv.user_id,
        customer_name: conv.customer_name ?? 'Cliente',
        customer_phone: conv.customer_phone,
        appointment_date: datePart,
        appointment_time: timePart,
        status: 'scheduled', // pendente de confirmação
      });
      msg = `${greet}consegui encaixar! Deixei reservado pra você ${fmtWhen(datePart, timePart)}. Confirma que tá de pé?`;
      fitted++;
      console.log(`[pending] ${conv.id} ENCAIXE ${datePart} ${timePart} (${maskPhone(conv.customer_phone)})`);
    } else {
      // alternativas: mais próximas no mesmo dia primeiro; se faltar, varre os próximos 7 dias
      const collected: string[] = nearest(freeSlots, timePart || '12:00', 2).map((s) => fmtWhen(datePart, s));
      for (let i = 1; i <= 7 && collected.length < 2; i++) {
        const d = addDays(datePart, i);
        const r = await computeFreeSlots(supabase, conv.user_id, d, settings as Record<string, unknown>);
        for (const s of r.freeSlots) {
          if (collected.length >= 2) break;
          collected.push(fmtWhen(d, s));
        }
      }
      if (collected.length === 0) {
        msg = `${greet}corri aqui e esse horário não vai dar, e tô sem brecha nos próximos dias nesse formato. Me diz outro dia que você prefere que eu dou um jeito?`;
      } else {
        const opts = collected.length === 1 ? collected[0] : `${collected[0]} ou ${collected[1]}`;
        msg = `${greet}esse horário tá apertado, mas consigo te encaixar ${opts}. Qual fica melhor?`;
      }
      alts++;
      console.log(`[pending] ${conv.id} ALTERNATIVAS [${collected.join(' | ')}] (${maskPhone(conv.customer_phone)})`);
    }

    const sent = await sendMessage(conv.customer_phone, msg, pid || undefined);
    if (!sent) console.error(`[pending] ${conv.id}: falha ao enviar WhatsApp (msg salva mesmo assim)`);
    await supabase.from('messages').insert({ conversation_id: conv.id, role: 'bot', content: msg });
    await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id);
  }

  console.log(`[pending] resumo: processed=${processed} encaixes=${fitted} alternativas=${alts} pulados=${skipped}`);
  return new Response(JSON.stringify({ processed, fitted, alts, skipped }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
