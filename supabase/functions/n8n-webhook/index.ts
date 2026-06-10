import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { maskPhone } from '../_shared/maskPII.ts';

// Array de status autorizados via CHECK CONSTRAINT
const VALID_LEAD_STATUS = ['novo', 'atendimento', 'proposta', 'negociacao', 'vendido', 'perdido'];
const VALID_APPOINTMENT_STATUS = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'];

// Helper para padronizar respostas
const buildResponse = (success, code, message, data = null, statusCode = 200) => {
  return new Response(
    JSON.stringify({ success, code, message, data }),
    {
      status: statusCode,
      headers: { "Content-Type": "application/json" }
    }
  );
};

// Instância com privilégio Admin (Bypassa RLS passivamente, executa inserts confiáveis)
const initSupabaseAdmin = () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase variables in Edge Environment");
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
};

serve(async (req) => {
  try {
    // 1. Apenas aceitar POST
    if (req.method !== 'POST') {
      return buildResponse(false, 'invalid_method', 'Only POST requests are allowed', null, 405);
    }

    // 2. Parse payload e sanitização básica
    let body;
    try {
      body = await req.json();
    } catch (_) {
      return buildResponse(false, 'invalid_payload', 'Payload must be valid JSON', null, 400);
    }

    const { action, payload } = body;

    if (!action || !payload || typeof payload !== 'object') {
      return buildResponse(false, 'invalid_payload', 'Missing action or payload object', null, 400);
    }

    const supabase = initSupabaseAdmin();

    // 3. Validação Crucial: User ID Existe?
    const { user_id } = payload;
    if (!user_id || typeof user_id !== 'string' || user_id.trim() === '') {
      return buildResponse(false, 'invalid_payload', 'user_id is missing or empty', null, 400);
    }

    const { data: profileCheck, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user_id.trim())
      .single();

    if (profileError || !profileCheck) {
      return buildResponse(false, 'invalid_user', `user_id ${user_id} not found in the system`, null, 401);
    }

    // ============================================================
    // FLUXO: CREATE LEAD
    // ============================================================
    if (action === 'create_lead') {
      const { name, phone, email, notes, car_id } = payload;
      let { status } = payload;

      // Validações Lead
      if (!name || name.trim() === '') return buildResponse(false, 'invalid_payload', 'name is required', null, 400);
      if (!phone || phone.trim() === '') return buildResponse(false, 'invalid_payload', 'phone is required', null, 400);
      
      status = status ? status.toLowerCase().trim() : 'novo';
      if (!VALID_LEAD_STATUS.includes(status)) {
         return buildResponse(false, 'invalid_payload', `Invalid status. Must be one of: ${VALID_LEAD_STATUS.join(', ')}`, null, 400);
      }

      // Validação de Duplicidade (7 Dias)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: duplicateLeads, error: dupError } = await supabase
        .from('leads')
        .select('id')
        .eq('user_id', user_id)
        .eq('phone', phone.trim())
        .gte('created_at', sevenDaysAgo.toISOString())
        .limit(1);

      if (dupError) throw dupError;

      if (duplicateLeads && duplicateLeads.length > 0) {
        console.warn(`[N8N-WEBHOOK] Duplicate lead rejected for user ${user_id} and phone ${maskPhone(phone)}`);
        return buildResponse(false, 'duplicate', 'A lead with this phone was already created in the last 7 days.', { lead_id: duplicateLeads[0].id }, 409);
      }

      // Inserção Consistente
      const { data: newLead, error: insertError } = await supabase
        .from('leads')
        .insert([{
          user_id: user_id,
          name: name.trim(),
          phone: phone.trim(),
          email: email ? email.trim() : null,
          status: status,
          notes: notes ? notes.trim() : null,
          car_id: car_id || null
        }])
        .select()
        .single();

      if (insertError) throw insertError;

      console.log(`[N8N-WEBHOOK] Successfully inserted new lead ${newLead.id} for user ${user_id}`);
      return buildResponse(true, 'created', 'Lead successfully created.', { lead: newLead }, 201);
    }
    
    // ============================================================
    // FLUXO: CREATE APPOINTMENT
    // ============================================================
    else if (action === 'create_appointment') {
      const { customer_name, customer_phone, customer_email, appointment_date, appointment_time, notes, car_id } = payload;
      let { status } = payload;

      // Validações Appointment
      if (!customer_name || customer_name.trim() === '') return buildResponse(false, 'invalid_payload', 'customer_name is required', null, 400);
      if (!customer_phone || customer_phone.trim() === '') return buildResponse(false, 'invalid_payload', 'customer_phone is required', null, 400);
      if (!appointment_date) return buildResponse(false, 'invalid_payload', 'appointment_date is required (YYYY-MM-DD)', null, 400);
      if (!appointment_time) return buildResponse(false, 'invalid_payload', 'appointment_time is required (HH:MM)', null, 400);

      status = status ? status.toLowerCase().trim() : 'scheduled';
      if (!VALID_APPOINTMENT_STATUS.includes(status)) {
         return buildResponse(false, 'invalid_payload', `Invalid status. Must be one of: ${VALID_APPOINTMENT_STATUS.join(', ')}`, null, 400);
      }

      // Inserção Consistente (Omitido de-duplication conforme req escopo atual - focando preenchimento direto)
      const { data: newAppt, error: insertError } = await supabase
        .from('appointments')
        .insert([{
          user_id: user_id,
          customer_name: customer_name.trim(),
          customer_phone: customer_phone.trim(),
          customer_email: customer_email ? customer_email.trim() : null,
          appointment_date: appointment_date.trim(),
          appointment_time: appointment_time.trim(),
          notes: notes ? notes.trim() : null,
          status: status,
          car_id: car_id || null
        }])
        .select()
        .single();

      if (insertError) throw insertError;

      console.log(`[N8N-WEBHOOK] Successfully inserted new appointment ${newAppt.id} for user ${user_id}`);
      return buildResponse(true, 'created', 'Appointment successfully created.', { appointment: newAppt }, 201);
    }

    // Ação desconhecida
    return buildResponse(false, 'invalid_payload', `Unknown action: ${action}`, null, 400);

  } catch (error) {
    console.error('[N8N-WEBHOOK] FATAL ERROR:', error);
    return buildResponse(false, 'server_error', 'An internal server error occurred while processing the request', null, 500);
  }
});
