import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { sendMessage, sendImage, sendVideo, resolveWhatsAppToken } from '../_shared/whatsapp.ts';
import { enviarSocial, enviarImagemSocial, enviarVideoSocial } from '../_shared/social.ts';
import { paraEnvio } from '../_shared/imagemUrl.ts';
import { buildCors } from '../_shared/cors.ts';
import { maskPhone } from '../_shared/maskPII.ts';

serve(async (req) => {
  const CORS = buildCors(req);
  const jsonResponse = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405);
  }

  // ── autenticação via JWT do usuário logado ─────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Authorization header ausente' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  // Cliente com JWT do usuário — respeita RLS para validar propriedade
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Cliente admin — para leitura de company_settings e envio ao WhatsApp
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: { conversation_id?: string; text?: string; car_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }

  const { conversation_id, text, car_id } = body;

  // Com car_id o texto e opcional: a ficha do veiculo e montada aqui.
  if (!conversation_id || (!car_id && !text?.trim())) {
    return jsonResponse({ error: 'conversation_id e (text ou car_id) são obrigatórios' }, 400);
  }

  // ── valida que o usuário é dono da conversa (via RLS) ──────────────────────
  const { data: conv, error: convErr } = await userClient
    .from('conversations')
    .select('id, user_id, customer_phone, status, channel, phone_number_id')
    .eq('id', conversation_id)
    .single();

  if (convErr || !conv) {
    return jsonResponse({ error: 'Conversa não encontrada' }, 404);
  }

  const now = new Date().toISOString();

  // Canal da conversa. Sem isto o CRM mandava tudo pro Graph do WhatsApp — e
  // numa conversa de Instagram o "telefone" e na verdade um PSID, entao a
  // mensagem sumia: o vendedor via enviada no CRM e o cliente nao recebia nada.
  const canal = String((conv as { channel?: string }).channel ?? 'whatsapp');
  const ehSocial = canal === 'instagram' || canal === 'messenger';

  // Credenciais resolvidas uma vez: buscar por mensagem faria uma consulta ao
  // Vault a cada foto enviada.
  let contaSocial = '';
  let tokenSocial = '';
  if (ehSocial) {
    const { data: cfgSocial } = await adminClient
      .from('company_settings')
      .select('ig_user_id, fb_page_id')
      .eq('user_id', conv.user_id)
      .single();
    contaSocial = String(
      (canal === 'instagram' ? cfgSocial?.ig_user_id : cfgSocial?.fb_page_id) ?? '',
    );
    const { data: tk } = await adminClient.rpc('get_meta_page_token', {
      p_user_id: conv.user_id, p_canal: canal,
    });
    tokenSocial = String(tk ?? '');
  }

  /** Envia texto no canal certo. */
  const enviarTexto = async (destino: string, texto: string, pid: string, tokenWa: string) => {
    if (!ehSocial) return await sendMessage(destino, texto, pid || undefined, tokenWa);
    const r = await enviarSocial(contaSocial, destino, texto, tokenSocial, canal as 'instagram' | 'messenger');
    if (!r.ok) console.error('[SAM] falha no envio social:', r.erro);
    return r.ok;
  };

  /** Envia imagem no canal certo, redimensionada para envio.
   *
   *  O `url` original e o que vai para `messages` em quem chama — aqui so
   *  muda o que a Meta baixa. Foto de carro tem 2,6 MB em media e a Meta
   *  recomprime tudo que recebe, entao mandar o original e banda jogada fora
   *  sem o cliente ver diferenca. */
  const enviarFoto = async (destino: string, url: string, pid: string, tokenWa: string) => {
    const urlEnvio = paraEnvio(url);
    if (!ehSocial) return await sendImage(destino, urlEnvio, pid || undefined, tokenWa);
    const r = await enviarImagemSocial(contaSocial, destino, urlEnvio, tokenSocial, canal as 'instagram' | 'messenger');
    if (!r.ok) console.error('[SAM] falha ao enviar foto social:', r.erro);
    return r.ok;
  };

  // ── ENVIO DE VEÍCULO ───────────────────────────────────────────────────────
  // Quando o vendedor assume a conversa ele perdia a ferramenta que o bot tem:
  // não havia como mandar foto de carro pelo CRM. Aqui ele escolhe o veículo e
  // sai ficha + galeria + vídeo de uma vez, no mesmo formato que o bot usa —
  // por isso o CRM renderiza igual.
  if (car_id) {
    // userClient (não admin): o RLS garante que o veículo é da loja dele.
    const { data: carro, error: carErr } = await userClient
      .from('cars')
      .select('id, brand, model, version, year, mileage, price, transmission, fuel, specs_image_url, video_url')
      .eq('id', car_id)
      .single();

    if (carErr || !carro) return jsonResponse({ error: 'Veículo não encontrado' }, 404);

    const { data: cfg } = await adminClient
      .from('company_settings')
      .select('whatsapp_phone_number_id')
      .eq('user_id', conv.user_id)
      .single();
    // Sai pelo mesmo numero que recebeu (ver 083). Cai no da loja quando a
    // conversa e anterior a migration.
    const pid = String((conv as { phone_number_id?: string | null }).phone_number_id || cfg?.whatsapp_phone_number_id || '');
    const tk  = await resolveWhatsAppToken(adminClient, conv.user_id);
    const fone = conv.customer_phone as string;

    const linhas = [
      `*${carro.brand} ${carro.model}*${carro.version ? ` ${carro.version}` : ''}`,
      carro.year ? `Ano ${carro.year}` : '',
      carro.mileage != null ? `${Number(carro.mileage).toLocaleString('pt-BR')} km` : '',
      [carro.transmission, carro.fuel].filter(Boolean).join(' · '),
      carro.price != null ? `\nR$ ${Number(carro.price).toLocaleString('pt-BR')}` : '',
    ].filter(Boolean);
    const ficha = linhas.join('\n');

    // A ficha tambem registra se chegou. Antes o insert era incondicional, e
    // era por isso que so a FOTO sumia visivelmente: a foto so e gravada em
    // caso de sucesso, o texto era gravado sempre.
    const fichaOk = await enviarTexto(fone, ficha, pid, tk);
    await userClient.from('messages').insert({
      conversation_id, role: 'agent', content: ficha,
      ...(fichaOk ? {} : {
        wa_status: 'failed',
        wa_error: 'Não foi possível entregar. Verifique a conexão do WhatsApp da loja.',
      }),
    });

    // Galeria: specs primeiro (quando existe), depois as fotos na ordem da loja.
    // Teto de 8, igual ao que o painel deixa cadastrar e ao que o bot envia.
    const fotos: string[] = [];
    if (carro.specs_image_url) fotos.push(String(carro.specs_image_url));
    const { data: galeria } = await userClient
      .from('car_images')
      .select('image_url')
      .eq('car_id', car_id)
      .order('sort_order', { ascending: true })
      .limit(8);
    for (const g of (galeria ?? [])) {
      const u = String(g.image_url ?? '').trim();
      if (u && !fotos.includes(u)) fotos.push(u);   // dedupe: specs pode repetir a 1ª
    }

    let enviadas = 0;
    for (const url of fotos.slice(0, 8)) {
      // Atencao a assinatura: sendImage e (to, url, phoneNumberId, token) — NAO
      // tem legenda. Ja sendVideo tem, numa posicao diferente. Passar na ordem
      // errada nao quebra o build, so falha em runtime.
      const ok = await enviarFoto(fone, url, pid, tk);
      if (ok) {
        enviadas++;
        // Mesmo formato do bot: o CRM renderiza como imagem, não como URL crua.
        await userClient.from('messages').insert({ conversation_id, role: 'agent', content: `[foto] ${url}` });
      }
    }

    if (carro.video_url) {
      // Video nos canais sociais existe agora.
      //
      // Antes esta linha pulava o video quando o canal era social, com a nota
      // de que o comportamento por URL remota nao tinha sido testado. A
      // cautela era justa, mas o efeito era o vendedor mandar o carro pelo CRM
      // no Instagram e o cliente receber as fotos sem o video, sem ninguem
      // saber por que.
      //
      // `enviarVideoSocial` fecha isso: confere o limite de 25MB antes de
      // tentar e devolve o motivo quando recusa, em vez de sumir em silencio.
      let ok: boolean;
      if (ehSocial) {
        const r = await enviarVideoSocial(
          contaSocial, fone, String(carro.video_url), tokenSocial, canal as 'instagram' | 'messenger',
        );
        ok = r.ok;
        if (!ok) console.error('[SAM] falha ao enviar video social:', r.erro);
      } else {
        ok = await sendVideo(fone, String(carro.video_url), pid || undefined, undefined, tk);
      }
      if (ok) await userClient.from('messages').insert({ conversation_id, role: 'agent', content: `[vídeo] ${carro.video_url}` });
    }

    await adminClient.from('conversations').update({ last_message_at: now }).eq('id', conversation_id);
    return jsonResponse({ success: true, fotos: enviadas, video: Boolean(carro.video_url) });
  }

  // ── salva mensagem com role = 'agent' ──────────────────────────────────────
  const { data: msg, error: msgErr } = await userClient
    .from('messages')
    .insert({ conversation_id, role: 'agent', content: text.trim() })
    .select()
    .single();

  if (msgErr) {
    console.error('[SAM] Erro ao salvar mensagem:', msgErr);
    return jsonResponse({ error: 'Erro ao salvar mensagem' }, 500);
  }

  // ── atualiza last_message_at ───────────────────────────────────────────────
  await adminClient
    .from('conversations')
    .update({ last_message_at: now })
    .eq('id', conversation_id);

  // ── envia ao cliente pelo WhatsApp ─────────────────────────────────────────
  const { data: settings } = await adminClient
    .from('company_settings')
    .select('whatsapp_phone_number_id')
    .eq('user_id', conv.user_id)
    .single();

  const phoneNumberId = String((conv as { phone_number_id?: string | null }).phone_number_id || settings?.whatsapp_phone_number_id || '');
  const token = await resolveWhatsAppToken(adminClient, conv.user_id);

  const sent = await enviarTexto(conv.customer_phone as string, text.trim(), phoneNumberId, token);
  if (!sent) {
    console.error(`[SAM] Falha ao enviar WhatsApp para ${maskPhone(conv.customer_phone as string)}`);

    // Marca a mensagem como NAO ENTREGUE.
    //
    // Antes isto so virava uma linha de log e a funcao devolvia sucesso: o
    // vendedor via a mensagem no CRM e seguia achando que o cliente recebeu.
    // Na Leandrinho, 319 conversas estavam presas num numero que perdeu acesso
    // na Meta, e a equipe atendia no vazio sem saber.
    //
    // A tela JA sabe desenhar isso — `VistoWhats` trata `wa_status = 'failed'`
    // e mostra `wa_error`. So faltava alguem marcar.
    await adminClient
      .from('messages')
      .update({
        wa_status: 'failed',
        wa_error: 'Não foi possível entregar. Verifique a conexão do WhatsApp da loja.',
      })
      .eq('id', msg.id);
  }

  // `enviado` diz a verdade. A mensagem fica no historico de qualquer forma —
  // perder o que o vendedor escreveu seria pior —, mas quem chamou sabe o que
  // aconteceu.
  return jsonResponse({ success: true, enviado: sent, message_id: msg.id });
});
