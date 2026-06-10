import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

import { buildCors } from '../_shared/cors.ts';

serve(async (req) => {
  const corsHeaders = buildCors(req);
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

    // 1. Foto → Resumable Upload API (3 passos exigidos pela Meta para profile picture)
    if (photo_url) {
      const appId = Deno.env.get('META_APP_ID') ?? '';
      if (!appId) {
        return new Response(
          JSON.stringify({ error: 'META_APP_ID não configurado nos Secrets do Supabase.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // a) Baixa a imagem do Supabase Storage
      const imgRes = await fetch(photo_url);
      if (!imgRes.ok) throw new Error('Falha ao baixar imagem do Storage');
      const imgBytes   = await imgRes.arrayBuffer();
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';

      // b) Cria sessão de upload (retorna { "id": "upload:..." })
      const createRes = await fetch(
        `https://graph.facebook.com/v25.0/${appId}/uploads?file_length=${imgBytes.byteLength}&file_type=${encodeURIComponent(contentType)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${waToken}` },
        },
      );
      if (!createRes.ok) {
        const errBody = await createRes.text();
        throw new Error(`Criação de sessão de upload falhou: ${errBody}`);
      }
      const { id: uploadId } = await createRes.json() as { id: string };

      // c) Envia os bytes da imagem (retorna { "h": "..." } — esse é o handle real)
      const uploadRes = await fetch(
        `https://graph.facebook.com/v25.0/${uploadId}`,
        {
          method: 'POST',
          headers: {
            Authorization: `OAuth ${waToken}`,
            'file_offset': '0',
            'Content-Type': contentType,
          },
          body: new Uint8Array(imgBytes),
        },
      );
      if (!uploadRes.ok) {
        const errBody = await uploadRes.text();
        throw new Error(`Upload de bytes falhou: ${errBody}`);
      }
      const { h: handle } = await uploadRes.json() as { h: string };
      fileHandle = handle;
    }

    // 2. Atualiza o perfil do WhatsApp Business
    const profilePayload: Record<string, unknown> = { messaging_product: 'whatsapp' };
    if (about !== undefined && about !== null) profilePayload.about = about;
    if (fileHandle) profilePayload.profile_picture_handle = fileHandle;

    const profileRes = await fetch(
      `https://graph.facebook.com/v25.0/${phoneNumberId}/whatsapp_business_profile`,
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
