import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { timingSafeEqual } from 'https://deno.land/std@0.224.0/crypto/timing_safe_equal.ts';
import { parseInboundMessage, sendMessage, resolveWhatsAppToken, variantesTelefoneBR } from '../_shared/whatsapp.ts';
import { maskPhone } from '../_shared/maskPII.ts';
import { botPodeResponder, numeroBloqueado, COLUNAS_GUARDA } from '../_shared/botGuards.ts';

// ─── helpers ──────────────────────────────────────────────────────────────────

function ok(body = 'OK'): Response {
  return new Response(body, { status: 200 });
}

function err(status: number, msg: string): Response {
  return new Response(msg, { status });
}

function initAdmin() {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// HMAC-SHA256 usando Web Crypto (disponível em Deno)
async function computeHmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── status updates de campanhas (sent/delivered/read/failed) ──────────────────
// ADICIONAL ao processamento de mensagens — não substitui nada.
// Idempotente: só atualiza/incrementa se o status realmente mudou para aquele wamid.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Dispara a notificação no celular do lojista. Ninguém espera a resposta: push
// é acessório e NÃO pode atrasar nem derrubar o processamento da mensagem, que
// é o caminho crítico. Mas a chamada precisa sobreviver ao fim do handler —
// veja o waitUntil lá dentro.
function avisarNoCelular(userId: string, nome: string, texto: string, convId: string): void {
  try {
    const corpo = texto.length > 120 ? `${texto.slice(0, 117)}...` : texto;
    // waitUntil, e NÃO fetch solto: no runtime das edge functions o trabalho
    // assíncrono pendente é cancelado assim que o handler responde. Como este
    // webhook devolve ok() logo em seguida, o fetch morria antes de conectar e
    // a notificação nunca saía — sem erro em lugar nenhum, porque o .catch()
    // também morria junto.
    //
    // O fireProcess logo abaixo já usava waitUntil pelo mesmo motivo; o push
    // ficou de fora. Segue fire-and-forget do ponto de vista do fluxo: ninguém
    // espera a resposta, mas o runtime deixa a chamada terminar.
    // @ts-ignore — EdgeRuntime é global nas Supabase Edge Functions
    EdgeRuntime.waitUntil(
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({
          user_id: userId,
          titulo: nome || 'Novo contato',
          corpo,
          url: '/conversas',
          // Tag por conversa: cliente que manda cinco mensagens seguidas gera UMA
          // notificação que se atualiza, em vez de cinco empilhadas na tela.
          tag: `conversa-${convId}`,
        }),
      })
        .then(async (r) => {
          // Loga o VEREDITO do send-push aqui tambem. Quando a notificacao nao
          // chega, cruzar os dois lados e o que separa "o webhook nao chamou" de
          // "chamou e nao havia aparelho inscrito" — que exigem correcoes
          // completamente diferentes.
          const txt = await r.text().catch(() => '');
          console.log(`[WH-push] alvo=${userId} http=${r.status} resposta=${txt.slice(0, 160)}`);
        })
        .catch((e) => console.warn('[WH-push] falha ao disparar:', e)),
    );
  } catch (e) {
    console.warn('[WH-push] erro inesperado:', e);
  }
}

// Extensão por mime. Nota de voz do WhatsApp chega como 'audio/ogg; codecs=opus',
// por isso o mime é cortado no ';' antes de consultar aqui.
const EXTENSAO: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'audio/aac': 'aac', 'audio/amr': 'amr',
};

// Baixa a mídia da Meta e sobe pro nosso Storage, devolvendo a URL pública.
// A URL que a Meta entrega EXPIRA em minutos: sem copiar, o lojista abre a
// conversa depois e não vê nada, e o Claude não tem como ler a foto.
async function baixarMidiaParaStorage(
  supabase: any,
  userId: string,
  convId: string,
  mediaId: string,
  token: string,
): Promise<string> {
  // 1. A Meta devolve a URL da mídia, não a mídia.
  const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const metaJson = await metaRes.json().catch(() => ({}));
  const mediaUrl = String(metaJson?.url ?? '');
  if (!mediaUrl) throw new Error('sem url da mídia');

  // 2. Baixar exige o token de novo — a URL sozinha não abre.
  const dl = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!dl.ok) throw new Error(`download ${dl.status}`);
  const bytes = new Uint8Array(await dl.arrayBuffer());
  const mime  = (dl.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim();
  const ext   = EXTENSAO[mime] ?? 'bin';

  // 3. Storage nosso, caminho por conversa pra facilitar limpeza depois.
  const caminho = `${userId}/${convId}/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('chat-media')
    .upload(caminho, bytes, { contentType: mime, upsert: false });
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  const { data: pub } = supabase.storage.from('chat-media').getPublicUrl(caminho);
  const url = String(pub?.publicUrl ?? '');
  if (!url) throw new Error('sem url pública');
  return url;
}

async function processStatuses(payload: any): Promise<void> {
  try {
    const entries = payload?.entry ?? [];
    let supabase: ReturnType<typeof initAdmin> | null = null;

    for (const entry of entries) {
      for (const change of (entry?.changes ?? [])) {
        const statuses = change?.value?.statuses;
        if (!Array.isArray(statuses) || statuses.length === 0) continue;

        if (!supabase) supabase = initAdmin();

        for (const status of statuses) {
          const wamid = status?.id;
          const newStatus = status?.status; // sent | delivered | read | failed
          if (!wamid || !newStatus) continue;

          const ts = status?.timestamp
            ? new Date(parseInt(status.timestamp, 10) * 1000).toISOString()
            : new Date().toISOString();

          console.log('[webhook-status]', wamid, '→', newStatus);

          // Mensagem do bot na conversa: é o "visto" que o lojista vê no CRM.
          // Só avança o status (sent → delivered → read); a Meta às vezes
          // entrega os eventos fora de ordem, e um 'delivered' atrasado não
          // pode apagar um 'read' que já chegou.
          const ORDEM: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };
          const { data: msg } = await supabase
            .from('messages')
            .select('id, wa_status')
            .eq('wa_message_id', wamid)
            .maybeSingle();

          // Quando falha, a Meta diz POR QUE num array `errors`. Sem guardar,
          // o lojista ve so um "!" vermelho e a causa so aparece indo no Graph
          // API Explorer na mao.
          const erroMeta = Array.isArray(status?.errors) && status.errors.length
            ? [status.errors[0]?.code, status.errors[0]?.title || status.errors[0]?.message]
                .filter(Boolean).join(' - ')
            : null;
          if (newStatus === 'failed') {
            console.error('[webhook-status] FALHA', wamid, JSON.stringify(status?.errors ?? []));
          }

          if (msg && (ORDEM[newStatus] ?? 0) > (ORDEM[String(msg.wa_status)] ?? 0)) {
            await supabase
              .from('messages')
              .update({ wa_status: newStatus, wa_error: erroMeta })
              .eq('id', msg.id);
          }

          // Busca o envio de campanha por wamid. Se não existir, não é campanha — ignora.
          const { data: existing } = await supabase
            .from('campaign_sends')
            .select('id, status, campaign_id')
            .eq('whatsapp_message_id', wamid)
            .maybeSingle();

          if (!existing) continue;
          // Idempotência: mesmo status já registrado → não incrementa de novo
          if (existing.status === newStatus) {
            console.log('[webhook-status] sem mudança (idempotente):', wamid, newStatus);
            continue;
          }

          const updates: Record<string, unknown> = { status: newStatus };
          if (newStatus === 'sent') updates.sent_at = ts;
          else if (newStatus === 'delivered') updates.delivered_at = ts;
          else if (newStatus === 'read') updates.read_at = ts;
          else if (newStatus === 'failed') {
            updates.failed_at = ts;
            updates.error_message = JSON.stringify(status?.errors ?? {});
          }

          await supabase.from('campaign_sends').update(updates).eq('id', existing.id);

          // Incremento atômico do contador agregado da campanha
          await supabase.rpc('increment_campaign_counter', {
            campaign_id: existing.campaign_id,
            field_name: `${newStatus}_count`,
          });

          console.log('[webhook-status] atualizado', existing.id, existing.status, '→', newStatus);
        }
      }
    }
  } catch (e) {
    console.error('[webhook-status] erro:', e);
  }
}

type ConvRow = {
  id: string;
  status: string;
  customer_phone: string;
  customer_name: string | null;
};

/**
 * Acha a conversa do cliente, tolerando o nono dígito, ou cria uma nova.
 *
 * A campanha grava o número como está no cadastro (5515996311510) e a Meta
 * responde no formato dela, que para celular antigo costuma vir sem o 9
 * (551596311510). Casando telefone literal, a resposta do cliente abriria uma
 * conversa NOVA, separada do disparo que a gerou — o lojista veria duas linhas
 * pra mesma pessoa e o bot atenderia sem saber o que foi prometido.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function acharOuCriarConversa(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, userId: string, from: string, senderName: string, now: string,
): Promise<ConvRow | null> {
  const variantes = variantesTelefoneBR(from);

  // Só vale a busca extra quando o número TEM outra forma possível.
  if (variantes.length > 1) {
    const { data: existente } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      // Filtra o canal: depois do multicanal, um PSID de Instagram tambem e um
      // numero longo, e sem isto uma mensagem de WhatsApp poderia se agarrar
      // numa conversa de outro canal.
      .eq('channel', 'whatsapp')
      .in('customer_phone', variantes)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (existente) {
      if (String(existente.customer_phone) !== from) {
        console.log(`[WH] conversa reaproveitada por variante do 9: ${maskPhone(String(existente.customer_phone))} ← ${maskPhone(from)}`);
      }
      const { data: atualizada } = await supabase
        .from('conversations')
        .update({
          last_message_at: now,
          // O nome do perfil só preenche vazio: o que já está lá pode ter vindo
          // do cadastro da loja, que costuma ser mais completo.
          customer_name: existente.customer_name || senderName || null,
        })
        .eq('id', existente.id)
        .select()
        .single();
      return (atualizada ?? existente) as ConvRow;
    }
  }

  const { data: nova, error } = await supabase
    .from('conversations')
    .upsert(
      // channel explicito: a migration 037 trocou a chave unica de
      // (user_id, customer_phone) para (user_id, channel, customer_phone), pra
      // o mesmo telefone poder existir em canais diferentes. Sem incluir o
      // canal aqui, o ON CONFLICT nao acha constraint nenhuma (42P10), o upsert
      // falha e a mensagem do cliente e DESCARTADA — foi o que derrubou o
      // WhatsApp em 21/08, no instante em que a 037 rodou.
      {
        user_id: userId,
        channel: 'whatsapp',
        customer_phone: from,
        customer_name: senderName || null,
        last_message_at: now,
      },
      { onConflict: 'user_id,channel,customer_phone' },
    )
    .select()
    .single();

  if (error || !nova) {
    console.error('[WH] Erro ao upsert conversa:', error);
    return null;
  }
  return nova as ConvRow;
}

// ─── main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  const url = new URL(req.url);

  // ── GET: verificação inicial do webhook pela Meta ──────────────────────────
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const expected = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';

    if (mode === 'subscribe' && token === expected && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return err(403, 'Forbidden');
  }

  if (req.method !== 'POST') {
    return err(405, 'Method Not Allowed');
  }

  // ── POST: mensagem recebida ─────────────────────────────────────────────────

  // 1. Lê o corpo UMA vez (necessário antes de verificar assinatura)
  const rawBody = await req.text();

  // 2. Verifica assinatura HMAC-SHA256
  // Para o provider 'cloud' (Meta), a verificação é obrigatória.
  // Para 'evolution', a assinatura não existe — pula.
  const provider = Deno.env.get('WHATSAPP_PROVIDER') ?? 'cloud';
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET') ?? '';

  if (provider === 'cloud') {
    if (!appSecret) {
      console.error('[WH] WHATSAPP_APP_SECRET não configurado para provider cloud');
      return err(500, 'Webhook não configurado corretamente');
    }
    const sig = req.headers.get('x-hub-signature-256') ?? '';
    const expected = 'sha256=' + (await computeHmac(appSecret, rawBody));
    // Comparação em tempo constante para evitar timing attacks
    const sigBytes = new TextEncoder().encode(sig);
    const expBytes = new TextEncoder().encode(expected);
    if (sigBytes.length !== expBytes.length || !timingSafeEqual(sigBytes, expBytes)) {
      console.warn('[WH] Assinatura inválida');
      return err(401, 'Unauthorized');
    }
  }

  // 3. Parse do payload
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return ok(); // Payload mal formado — responde 200 para não retentar
  }

  // Processa status updates de campanhas (sent/delivered/read/failed).
  // ADICIONAL: não interfere no fluxo de mensagens abaixo.
  await processStatuses(payload);

  const msg = parseInboundMessage(payload);
  if (!msg) {
    // Não é uma mensagem de texto válida (pode ser status/delivery receipt — já tratado acima)
    return ok();
  }

  const { phoneNumberId, from, senderName, text, waMessageId } = msg;
  const supabase = initAdmin();

  // 4. Deduplicação: verifica se já processamos esta mensagem
  const { data: existing } = await supabase
    .from('messages')
    .select('id')
    .eq('wa_message_id', waMessageId)
    .maybeSingle();

  if (existing) {
    return ok(); // Reenvio do WhatsApp — ignora
  }

  // 5. Resolve a concessionária pelo phone_number_id cadastrado
  //
  // O erro do select é lido de propósito. Antes só o `data` era desestruturado,
  // e uma coluna faltando (migration não aplicada) fazia o select inteiro falhar
  // -> settings null -> o código concluía "número não cadastrado" e DESCARTAVA a
  // mensagem do cliente, em silêncio. Aconteceu em 20/08 com bot_enabled.
  // São duas situações opostas: número desconhecido é normal, select quebrado é
  // incidente — e não podem terminar no mesmo lugar.
  let { data: settings, error: settingsErr } = await supabase
    .from('company_settings')
    .select(`user_id, ${COLUNAS_GUARDA}`)
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .maybeSingle();

  if (settingsErr) {
    console.error('[WH] select de company_settings falhou:', settingsErr.message);
    // Reduz ao mínimo indispensável pra rotear. Perder recurso novo é ruim;
    // perder a mensagem do cliente é inaceitável.
    const retry = await supabase
      .from('company_settings')
      .select('user_id')
      .eq('whatsapp_phone_number_id', phoneNumberId)
      .maybeSingle();
    if (retry.error) {
      console.error('[WH] fallback tambem falhou:', retry.error.message);
    } else if (retry.data?.user_id) {
      console.warn('[WH] seguindo com defaults (schema desatualizado?)');
      settings = retry.data as typeof settings;
    }
  }

  if (!settings?.user_id) {
    console.warn(`[WH] phone_number_id não cadastrado: ${phoneNumberId}`);
    return ok();
  }

  const userId = settings.user_id;

  // 6. Acha ou cria a conversa
  const now = new Date().toISOString();
  const upsertedConv = await acharOuCriarConversa(supabase, userId, from, senderName, now);

  if (!upsertedConv) {
    console.error('[WH] Erro ao upsert conversa');
    return ok();
  }

  // 7. Garante que existe um lead para este contato (cria apenas se não existir)
  const { data: existingLead } = await supabase
    .from('leads')
    .select('id')
    .eq('user_id', userId)
    .eq('phone', from)
    .maybeSingle();

  if (!existingLead) {
    await supabase.from('leads').insert({
      user_id: userId,
      name: senderName || 'Cliente WhatsApp',
      phone: from,
      status: 'novo',
      notes: 'Lead criado automaticamente via WhatsApp',
    });
  }

  // 8. Helper: aciona process-conversation de forma assíncrona (mantém a function viva)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  // Espera um instante antes de acionar o bot.
  //
  // A trava contra processamento duplo usa o id da ULTIMA mensagem do cliente
  // como chave. Cliente que manda foto e texto em seguida gera dois webhooks:
  // disparando na hora, o primeiro trava com a chave da foto e o segundo com a
  // do texto — chaves diferentes, nenhuma bloqueia a outra, e o modelo roda
  // duas vezes. Foi assim que o bot cumprimentou o mesmo cliente duas vezes.
  //
  // Com a pausa, as duas execucoes leem a MESMA ultima mensagem, chegam na
  // mesma chave, e a segunda aborta. De quebra o bot responde as duas mensagens
  // juntas, que e o que uma pessoa faria.
  //
  // Nao atrasa a resposta ao Meta: isto roda dentro do waitUntil, depois do
  // ok().
  const ESPERA_LOTE_MS = 2000;

  const fireProcess = (conversationId: string) => {
    // @ts-ignore — EdgeRuntime é global nas Supabase Edge Functions
    EdgeRuntime.waitUntil(
      new Promise((r) => setTimeout(r, ESPERA_LOTE_MS)).then(() =>
      fetch(`${supabaseUrl}/functions/v1/process-conversation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch((e: unknown) => console.error('[WH] Erro ao acionar process-conversation:', e))),
    );
  };

  // 9-eco. Coexistência: quem falou foi o LOJISTA, pelo celular dele.
  //   Grava pra aparecer no CRM, NÃO aciona o bot, e passa a conversa para
  //   'human': se o dono está respondendo pelo aparelho, o bot respondendo
  //   junto significaria duas vozes na mesma conversa. Volta ao bot quando
  //   alguém clicar "Devolver pro bot" no CRM.
  if (msg.isEcho) {
    // Mídia que o lojista manda pelo celular (coexistência). Guardamos o
    // arquivo em vez de transcrever: quem falou foi o próprio vendedor, o valor
    // aqui é o registro pro time — e transcrever todo áudio dele seria custo
    // recorrente sem ganho. O áudio do CLIENTE segue transcrito, porque ali o
    // bot precisa do texto pra responder.
    if (msg.type === 'image' || msg.type === 'audio') {
      const ehFoto = msg.type === 'image';
      const { data: ecoMidia, error: claimEcoErr } = await supabase
        .from('messages')
        .insert({
          conversation_id: upsertedConv.id,
          role: 'agent',
          content: ehFoto ? '📷 Imagem enviada…' : '🎤 Áudio enviado…',
          wa_message_id: waMessageId,
        })
        .select('id')
        .single();

      if (claimEcoErr || !ecoMidia) {
        console.warn('[WH] claim de eco com mídia falhou (duplicado?):', claimEcoErr?.message);
        return ok();
      }

      await supabase.from('conversations')
        .update({ status: 'human', last_message_at: now })
        .eq('id', upsertedConv.id);

      const convIdEco  = upsertedConv.id;
      const mediaIdEco = msg.mediaId ?? '';
      const legendaEco = text;

      // @ts-ignore — EdgeRuntime é global nas Supabase Edge Functions
      EdgeRuntime.waitUntil((async () => {
        try {
          const token = await resolveWhatsAppToken(supabase, userId);
          const url = await baixarMidiaParaStorage(supabase, userId, convIdEco, mediaIdEco, token);
          const marcador = ehFoto ? '[imagem]' : '[audio]';
          const conteudo = legendaEco ? `${marcador} ${url}
${legendaEco}` : `${marcador} ${url}`;
          await supabase.from('messages').update({ content: conteudo }).eq('id', ecoMidia.id);
          console.log(`[WH-eco] ${ehFoto ? 'imagem' : 'áudio'} do lojista salvo (${maskPhone(from)})`);
        } catch (e) {
          console.error('[WH-eco] falha ao salvar mídia do lojista:', e);
          // Aqui NÃO se responde ao cliente: quem mandou foi o próprio lojista,
          // e um "não consegui abrir" iria pro cliente sem fazer sentido.
          await supabase.from('messages')
            .update({ content: ehFoto ? '[imagem enviada pelo celular]' : '[áudio enviado pelo celular]' })
            .eq('id', ecoMidia.id);
        }
      })());

      return ok();
    }

    const { error: ecoErr } = await supabase.from('messages').insert({
      conversation_id: upsertedConv.id,
      role: 'agent',
      content: text,
      wa_message_id: waMessageId,
    });
    if (ecoErr) console.error('[WH] erro ao salvar eco:', ecoErr);

    await supabase.from('conversations')
      .update({ status: 'human', last_message_at: now })
      .eq('id', upsertedConv.id);

    console.log(`[WH] mensagem do lojista via celular (eco), bot não responde — ${maskPhone(from)}`);
    return ok();
  }

  // 9a. Mensagem de TEXTO — fluxo normal
  if (msg.type === 'text') {
    const { error: msgErr } = await supabase.from('messages').insert({
      conversation_id: upsertedConv.id,
      role: 'customer',
      content: text,
      wa_message_id: waMessageId,
    });
    if (msgErr) {
      console.error('[WH] Erro ao salvar mensagem:', msgErr);
      return ok();
    }
    avisarNoCelular(userId, senderName || upsertedConv.customer_name || '', text, upsertedConv.id);

    // Bot desligado ou fora da janela: a mensagem JA foi salva acima e a
    // conversa vai pra 'pendente'. Ficar so em silencio perderia o
    // atendimento — alguem precisa ver que o cliente escreveu.
    // Numero bloqueado: a mensagem JA foi salva acima e aparece no CRM
    // normalmente. So o bot nao responde.
    //
    // Vem ANTES do horario de propósito: bloqueio nao tem excecao, e checar
    // depois faria o log dizer "fora do horario" para um numero que nunca seria
    // respondido de qualquer forma.
    if (numeroBloqueado((settings as { bot_blocked_numbers?: unknown })?.bot_blocked_numbers, from)) {
      await supabase.from('conversations')
        .update({ status: 'pending' })
        .eq('id', upsertedConv.id)
        .neq('status', 'human');
      console.log(`[WH] numero na lista de bloqueio — bot nao responde (${maskPhone(from)})`);
      return ok();
    }

    if (!botPodeResponder(settings)) {
      await supabase.from('conversations')
        .update({ status: 'pending' })
        .eq('id', upsertedConv.id)
        .neq('status', 'human');   // ja assumida por alguem: nao mexe
      console.log(`[WH] bot fora do horario/desligado — conversa marcada como pendente (${maskPhone(from)})`);
      return ok();
    }

    if (upsertedConv.status !== 'human') fireProcess(upsertedConv.id);
    return ok();
  }

  // 9b. Mensagem de ÁUDIO — claim de dedup + transcrição em background
  // ── FOTO do cliente ────────────────────────────────────────────────────────
  //    Mesmo desenho do áudio: reserva a mensagem (dedup pelo wamid) e faz o
  //    trabalho pesado em segundo plano, pra Meta receber o 200 na hora.
  //
  //    Copiamos a imagem pro nosso Storage porque a URL que a Meta devolve
  //    EXPIRA em minutos — sem isso o lojista abriria a conversa depois e não
  //    veria a foto, e o Claude não teria como lê-la.
  if (msg.type === 'image') {
    const { data: imgMsg, error: claimImgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: upsertedConv.id,
        role: 'customer',
        content: '📷 Imagem recebida…',
        wa_message_id: waMessageId,
      })
      .select('id')
      .single();

    if (claimImgErr || !imgMsg) {
      console.warn('[WH] claim de imagem falhou (duplicado?):', claimImgErr?.message);
      return ok();
    }

    const convIdImg  = upsertedConv.id;
    const isHumanImg = upsertedConv.status === 'human';
    const mediaIdImg = msg.mediaId ?? '';
    const legenda    = text;   // o cliente quase sempre escreve junto com a foto

    // @ts-ignore — EdgeRuntime é global nas Supabase Edge Functions
    EdgeRuntime.waitUntil((async () => {
      try {
        const token = await resolveWhatsAppToken(supabase, userId);

        // 1. A Meta devolve a URL da mídia, não a mídia.
        const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaIdImg}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const metaJson = await metaRes.json().catch(() => ({}));
        const mediaUrl = String(metaJson?.url ?? '');
        if (!mediaUrl) throw new Error('sem url da mídia');

        // 2. Baixar exige o token de novo — a URL sozinha não abre.
        const dl = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!dl.ok) throw new Error(`download ${dl.status}`);
        const bytes = new Uint8Array(await dl.arrayBuffer());
        const mime  = dl.headers.get('content-type') ?? 'image/jpeg';
        const ext   = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';

        // 3. Storage nosso, caminho por conversa pra facilitar limpeza depois.
        const caminho = `${userId}/${convIdImg}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('chat-media')
          .upload(caminho, bytes, { contentType: mime, upsert: false });
        if (upErr) throw new Error(`upload: ${upErr.message}`);

        const { data: pub } = supabase.storage.from('chat-media').getPublicUrl(caminho);
        const url = String(pub?.publicUrl ?? '');
        if (!url) throw new Error('sem url pública');

        // 4. Mesmo formato do [foto] que o bot envia, pro CRM renderizar igual.
        //    A legenda entra na mesma linha: é o que o cliente perguntou.
        const conteudo = legenda ? `[imagem] ${url}
${legenda}` : `[imagem] ${url}`;
        await supabase.from('messages').update({ content: conteudo }).eq('id', imgMsg.id);

        console.log(`[WH-img] imagem salva (${maskPhone(from)})${legenda ? ' com legenda' : ''}`);
        if (!isHumanImg) fireProcess(convIdImg);
      } catch (e) {
        console.error('[WH-img] falha ao processar imagem:', e);
        // Sem a foto o bot não tem o que ler — avisa em vez de deixar no vácuo.
        await supabase.from('messages')
          .update({ content: '[imagem que não consegui abrir]' }).eq('id', imgMsg.id);
        const token = await resolveWhatsAppToken(supabase, userId);
        const aviso = 'Recebi sua foto mas não consegui abrir aqui 😕 pode mandar de novo, ou me descrever o que é?';
        await sendMessage(from, aviso, phoneNumberId || undefined, token);
        await supabase.from('messages').insert({ conversation_id: convIdImg, role: 'bot', content: aviso });
        await supabase.from('conversations')
          .update({ last_message_at: new Date().toISOString() }).eq('id', convIdImg);
      }
    })());

    return ok();
  }

  if (msg.type === 'audio') {
    // Claim: insere já a mensagem (placeholder) para reservar o wa_message_id e
    // evitar transcrição dupla caso chegue uma entrega duplicada da Meta.
    const { data: audioMsg, error: claimErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: upsertedConv.id,
        role: 'customer',
        content: '🎤 Áudio recebido, transcrevendo…',
        wa_message_id: waMessageId,
        transcribed_from_audio: true,
      })
      .select('id')
      .single();

    if (claimErr || !audioMsg) {
      console.warn('[WH] claim de áudio falhou (duplicado?):', claimErr?.message);
      return ok();
    }

    const convId  = upsertedConv.id;
    const isHuman = upsertedConv.status === 'human';
    const mediaId = msg.mediaId ?? '';
    const pid     = phoneNumberId;

    // @ts-ignore — EdgeRuntime é global nas Supabase Edge Functions
    EdgeRuntime.waitUntil((async () => {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ media_id: mediaId, phone_number_id: pid, user_id: userId }),
        });
        const result = await res.json().catch(() => ({ success: false, code: 'openai_error' }));

        if (result?.success && result.text) {
          await supabase.from('messages').update({ content: result.text }).eq('id', audioMsg.id);
          console.log(`[WH-audio] transcrito (${maskPhone(from)}): ${String(result.text).length} chars`);
          if (!isHuman) fireProcess(convId);
          return;
        }

        // Erro de transcrição: registra marcador e responde de forma humana
        const code = String(result?.code ?? 'openai_error');
        console.error(`[WH-audio] falha (${maskPhone(from)}): ${code} ${result?.error ?? ''}`);
        await supabase.from('messages').update({ content: '[áudio com falha de transcrição]' }).eq('id', audioMsg.id);

        const FALLBACKS: Record<string, { msg: string; handoff: boolean }> = {
          too_large:       { msg: 'Recebi seu áudio mas é muito longo pra eu processar. Pode resumir por texto ou mandar em partes?', handoff: false },
          download_failed: { msg: 'Tive um problema técnico, pode mandar de novo?', handoff: true },
          timeout:         { msg: 'Recebi seu áudio mas tive um problema pra processar. Pode me mandar por texto?', handoff: true },
          openai_error:    { msg: 'Recebi seu áudio mas tive um problema pra processar. Pode me mandar por texto?', handoff: true },
        };
        const fb = FALLBACKS[code] ?? FALLBACKS.openai_error;

        const token = await resolveWhatsAppToken(supabase, userId);
        const sent = await sendMessage(from, fb.msg, pid || undefined, token);
        if (!sent) console.error('[WH-audio] falha ao enviar fallback (salvo no banco mesmo assim)');
        await supabase.from('messages').insert({ conversation_id: convId, role: 'bot', content: fb.msg });
        await supabase.from('conversations').update({
          last_message_at: new Date().toISOString(),
          ...(fb.handoff ? { status: 'pending' } : {}),
        }).eq('id', convId);
      } catch (e) {
        console.error('[WH-audio] exceção no processamento de áudio:', e);
      }
    })());

    return ok();
  }

  return ok(); // tipo não suportado
});
