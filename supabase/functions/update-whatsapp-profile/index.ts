import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Autentica o usuário via JWT do Supabase
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase    = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verifica o JWT e obtém o user_id
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !user) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    const body = await req.json() as { photo_url?: string; about?: string };
    const { photo_url, about } = body;

    // Carrega configurações da concessionária
    const { data: settings } = await supabase
      .from('company_settings')
      .select('whatsapp_phone_number_id')
      .eq('user_id', user.id)
      .single();

    const phoneNumberId = String(settings?.whatsapp_phone_number_id ?? '');
    if (!phoneNumberId) {
      return new Response(
        JSON.stringify({ error: 'whatsapp_phone_number_id não configurado em Configurações.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const waToken = Deno.env.get('WHATSAPP_TOKEN') ?? '';
    if (!waToken) {
      return new Response(
        JSON.stringify({ error: 'WHATSAPP_TOKEN não configurado nos Secrets.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let fileHandle: string | undefined;

    // 1. Se tiver foto, faz upload via WhatsApp Media API para obter file_handle
    if (photo_url) {
      // Baixa a imagem do Supabase Storage
      const imgRes = await fetch(photo_url);
      if (!imgRes.ok) throw new Error('Falha ao baixar imagem do Storage');
      const imgBlob = await imgRes.blob();
      const contentType = imgBlob.type || 'image/jpeg';

      // Upload para a Media API do WhatsApp
      const formData = new FormData();
      formData.append('file', imgBlob, 'profile.jpg');
      formData.append('type', contentType);
      formData.append('messaging_product', 'whatsapp');

      const uploadRes = await fetch(
        `https://graph.facebook.com/v18.0/${phoneNumberId}/media`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${waToken}` },
          body: formData,
        },
      );

      if (!uploadRes.ok) {
        const errBody = await uploadRes.text();
        throw new Error(`Upload de mídia falhou: ${errBody}`);
      }

      const uploadJson = await uploadRes.json() as { id?: string };
      fileHandle = uploadJson.id;
    }

    // 2. Atualiza o perfil do WhatsApp Business
    const profilePayload: Record<string, unknown> = { messaging_product: 'whatsapp' };
    if (about !== undefined && about !== null) profilePayload.about = about;
    if (fileHandle) profilePayload.profile_picture_handle = fileHandle;

    const profileRes = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/whatsapp_business_profile`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${waToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(profilePayload),
      },
    );

    if (!profileRes.ok) {
      const errBody = await profileRes.text();
      throw new Error(`Atualização do perfil falhou: ${errBody}`);
    }

    return new Response(
      JSON.stringify({ sucesso: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[update-whatsapp-profile]', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
