// iniciar-conversa — a loja fala primeiro com UMA pessoa.
//
// ── Por que existe ─────────────────────────────────────────────────────────
//
// Até aqui só havia dois jeitos de a loja falar primeiro: campanha (que exige
// lista e um registro em `campaigns`) e o aviso de lista de espera (que nasce
// de um carro entrando). Para "manda uma mensagem pro Jorge" não havia
// caminho nenhum — o vendedor saía do CRM, abria o WhatsApp no celular, e a
// conversa toda acontecia fora do sistema: sem histórico, sem o bot sabendo,
// sem aparecer no funil.
//
// ── Por que NÃO virou uma campanha de uma pessoa ───────────────────────────
//
// Seria mais rápido criar uma linha em `campaigns` com um destinatário e
// chamar `send-campaign`. Mas aí a tela de Marketing encheria de campanhas que
// ninguém disparou, e os contadores de enviados/falhas (que a loja usa pra
// decidir se o disparo funcionou) passariam a somar mensagens avulsas. É o
// mesmo motivo que fez o aviso da lista de espera ganhar a coluna
// `envio_ativo` em vez de uma campanha sintética.
//
// ── A regra das 24h é o coração disto ──────────────────────────────────────
//
// A Meta só aceita TEXTO LIVRE enquanto a janela de atendimento está aberta —
// 24 horas contadas da última mensagem DO CLIENTE. Fora dela, só template
// aprovado.
//
// E o modo de falha é silencioso: mandar texto livre fora da janela devolve
// sucesso na API e a mensagem simplesmente NÃO chega. Por isso esta função
// decide sozinha qual dos dois caminhos usar e devolve `via` pra tela poder
// dizer ao vendedor o que realmente saiu. Quem depende de alguém lembrar da
// regra das 24h já começou errado.
//
// ── A janela conta da última mensagem do CLIENTE ───────────────────────────
//
// Não de `last_message_at`, que inclui as nossas. Se o bot respondeu 15:00 e o
// cliente escreveu 14:00, a janela fecha às 14:00 do dia seguinte. Usar o
// campo errado faria a mensagem ser recusada sem erro visível.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { sendWhatsAppTemplate } from '../_shared/sendTemplate.ts';
import {
  resolveWhatsAppToken, variantesTelefoneBR, sendMessageComId,
} from '../_shared/whatsapp.ts';
import { maskPhone } from '../_shared/maskPII.ts';
import { podeDisparar, COLUNAS_DISPARO } from '../_shared/botGuards.ts';
import { buildCors } from '../_shared/cors.ts';

// Margem sobre as 24h da Meta. Entre esta função decidir e a mensagem sair, o
// relógio anda; e o `created_at` do banco e o da Meta não são o mesmo instante.
// Errar pra menos custa um template; errar pra mais entrega nada.
const JANELA_HORAS = 23;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

/**
 * Variáveis do corpo, por posição — MESMA convenção de `send-campaign`:
 * `{ "1": "...", "2": "..." }`, chaves numéricas apenas.
 *
 * Só as chaves numéricas entram. Qualquer outra (um `header_image` colado por
 * engano) viraria parâmetro de corpo — `parseInt('header_image')` é NaN, que a
 * ordenação não descarta — e um parâmetro a mais faz a Meta recusar a mensagem
 * inteira. Esse erro já aconteceu no disparo com imagem.
 *
 * Os substitutos de data/hora do disparo NÃO existem aqui de propósito: não há
 * agendamento no contexto de uma conversa que está começando, e um
 * `{{data_visita}}` que não resolve sairia literal no texto do cliente.
 */
function montarParametros(variaveis: DB, nome: string): { type: 'text'; text: string }[] {
  const params: { type: 'text'; text: string }[] = [];
  if (!variaveis) return params;
  const chaves = Object.keys(variaveis)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => parseInt(a) - parseInt(b));
  for (const k of chaves) {
    let valor = variaveis[k];
    if (typeof valor === 'string') {
      const completo = nome || 'cliente';
      valor = valor
        .replace(/\{\{nome_cliente\}\}/g, completo)
        .replace(/\{\{primeiro_nome\}\}/g, String(completo).split(' ')[0]);
    }
    params.push({ type: 'text', text: String(valor ?? '') });
  }
  return params;
}

/** Troca {{1}}, {{2}}… pelo que foi realmente enviado — é esse texto que o
 *  cliente leu, e é ele que precisa ficar no CRM, não o template cru. */
function renderizarCorpo(body: string | null | undefined, params: Array<{ text?: string }>): string {
  let texto = String(body ?? '');
  params.forEach((p, i) => {
    texto = texto.replaceAll(`{{${i + 1}}}`, String(p?.text ?? ''));
  });
  return texto;
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    // ── Quem está pedindo ────────────────────────────────────────────────
    //
    // O `user_id` vem do JWT, NUNCA do corpo da requisição. Com ele no corpo,
    // qualquer conta autenticada mandaria mensagem pelo número de outra loja.
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authorization ausente' }, 401);

    const anon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    // JWT explícito: sem o argumento o supabase-js procura a sessão no
    // armazenamento local, que não existe no runtime da edge function, e
    // devolve user null mesmo com o header certo.
    const { data: { user }, error: authErr } =
      await anon.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) return json({ error: 'Não autenticado' }, 401);

    const userId = user.id;

    const corpo = await req.json().catch(() => ({}));
    const telefone  = String(corpo?.phone ?? '').replace(/\D/g, '');
    const nome      = String(corpo?.name ?? '').trim();
    const texto     = String(corpo?.texto ?? '').trim();
    const templateId = String(corpo?.template_id ?? '').trim();
    const variaveis = corpo?.variaveis ?? null;

    if (telefone.length < 10) {
      return json({ error: 'Telefone inválido. Use DDD + número.' }, 400);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // ── Número da loja ───────────────────────────────────────────────────
    const { data: settings } = await admin
      .from('company_settings')
      .select(`whatsapp_phone_number_id, company_name, ${COLUNAS_DISPARO}`)
      .eq('user_id', userId)
      .maybeSingle();

    const phoneNumberId = String(settings?.whatsapp_phone_number_id ?? '').trim();
    if (!phoneNumberId) {
      return json({ error: 'Esta conta não tem número de WhatsApp configurado.' }, 400);
    }

    // ── A conversa já existe? E a janela está aberta? ────────────────────
    const variantes = variantesTelefoneBR(telefone);
    const { data: conversaExistente } = await admin
      .from('conversations')
      .select('id, customer_name, status')
      .eq('user_id', userId)
      .eq('channel', 'whatsapp')
      .eq('phone_number_id', phoneNumberId)
      .in('customer_phone', variantes)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    let janelaAberta = false;
    if (conversaExistente?.id) {
      const { data: ultimaDoCliente } = await admin
        .from('messages')
        .select('created_at')
        .eq('conversation_id', conversaExistente.id)
        .eq('role', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ultimaDoCliente?.created_at) {
        const idadeH = (Date.now() - Date.parse(String(ultimaDoCliente.created_at))) / 3600000;
        janelaAberta = idadeH >= 0 && idadeH < JANELA_HORAS;
      }
    }

    // ── Caminho A: janela aberta → texto livre, de graça ─────────────────
    //
    // Sem guarda de plano aqui: isto é exatamente o que o vendedor já faz hoje
    // ao assumir a conversa e digitar. A fronteira nova é o template, abaixo.
    if (janelaAberta && texto) {
      const token = await resolveWhatsAppToken(admin, userId);
      const { ok, wamid } = await sendMessageComId(telefone, texto, phoneNumberId, token);
      if (!ok) return json({ error: 'A Meta recusou a mensagem.' }, 502);

      await registrar(admin, {
        userId, telefone, nome, phoneNumberId,
        texto, waMessageId: wamid, convId: conversaExistente?.id ?? null,
      });
      console.log('[iniciar-conversa] texto livre para', maskPhone(telefone));
      return json({ ok: true, via: 'texto_livre', janela_aberta: true });
    }

    // ── Caminho B: fora da janela → só template aprovado ─────────────────
    if (!templateId) {
      return json({
        error: janelaAberta
          ? 'Escreva a mensagem.'
          : 'Faz mais de 24h que esta pessoa não escreve. Fora dessa janela a Meta só entrega template aprovado — escolha um.',
        janela_aberta: janelaAberta,
        precisa_template: !janelaAberta,
      }, 400);
    }

    // Template pago é o produto "disparo". Um plano que não o inclui não
    // manda template avulso por uma porta lateral — a trava é no servidor, não
    // na tela.
    if (!podeDisparar(settings)) {
      return json({ error: 'Envio de template não faz parte do plano desta conta.' }, 403);
    }

    // `eq('user_id')` não é decoração: sem ele, um id de template de outra
    // loja passaria, e a mensagem sairia pelo número desta.
    const { data: template } = await admin
      .from('message_templates')
      .select('meta_template_name, language, body_text, header_type, header_content')
      .eq('id', templateId)
      .eq('user_id', userId)
      .eq('status', 'approved')
      .maybeSingle();

    if (!template) {
      return json({ error: 'Template não encontrado ou ainda não aprovado pela Meta.' }, 400);
    }

    const bodyParameters = montarParametros(variaveis, nome);

    // Template com cabeçalho de mídia EXIGE o parâmetro do cabeçalho em TODO
    // envio: omitir faz a Meta recusar a mensagem, não enviar sem a foto. O
    // fallback é a imagem de exemplo da própria aprovação.
    const tipoCabecalho = String(template.header_type ?? '').toUpperCase();
    const ehMidia = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(tipoCabecalho);
    const urlCabecalho = ehMidia
      ? String(variaveis?.header_image ?? template.header_content ?? '').trim()
      : '';
    if (ehMidia && !urlCabecalho) {
      return json({ error: 'Este template tem cabeçalho de imagem e nenhuma imagem foi informada.' }, 400);
    }
    const headerParameters = ehMidia
      ? [{
          type: tipoCabecalho.toLowerCase(),
          [tipoCabecalho.toLowerCase()]: { link: urlCabecalho },
        } as unknown as { type: 'text' }]
      : undefined;

    const token = await resolveWhatsAppToken(admin, userId);

    let waMessageId: string | null = null;
    try {
      const envio = await sendWhatsAppTemplate({
        phone: telefone,
        templateName: String(template.meta_template_name),
        language: String(template.language ?? 'pt_BR'),
        bodyParameters,
        headerParameters,
        phoneNumberId,
        token,
      });
      waMessageId = envio?.messageId ?? null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[iniciar-conversa] template recusado:', msg);
      return json({ error: `A Meta recusou o template: ${msg.slice(0, 200)}` }, 502);
    }

    await registrar(admin, {
      userId, telefone, nome, phoneNumberId,
      texto: renderizarCorpo(template.body_text, bodyParameters),
      waMessageId, convId: conversaExistente?.id ?? null,
    });

    console.log('[iniciar-conversa] template', template.meta_template_name, 'para', maskPhone(telefone));
    return json({ ok: true, via: 'template', janela_aberta: false });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[iniciar-conversa] exceção:', msg);
    return json({ error: msg }, 500);
  }
});

/**
 * Grava a mensagem na conversa do cliente.
 *
 * POR QUE ISTO É METADE DA FEATURE, E NÃO UM DETALHE:
 * em 24/11 duas portas de envio ativo (disparo e lista de espera) mandaram
 * mensagem sem gravar — 164 mensagens perdidas numa, 5 na outra. Além de não
 * aparecer na tela, o BOT ficava sem saber o que a loja prometeu: a pessoa
 * respondia "qual era o carro?" e ele não tinha o texto.
 *
 * O `onConflict` leva as QUATRO colunas do índice único
 * (user_id, channel, customer_phone, phone_number_id). Com duas, o Postgres
 * devolve 42P10, o supabase-js NÃO lança (devolve {data, error}) e a gravação
 * falha em silêncio — foi exatamente assim que o disparo perdeu as 164.
 */
async function registrar(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  { userId, telefone, nome, phoneNumberId, texto, waMessageId, convId }: {
    userId: string; telefone: string; nome: string; phoneNumberId: string;
    texto: string; waMessageId: string | null; convId: string | null;
  },
) {
  try {
    const agora = new Date().toISOString();
    let id = convId;

    if (id) {
      // `last_message_at` É a ordenação da lista de conversas. Sem atualizar,
      // a conversa fica ordenada pela mensagem antiga e o lojista não acha o
      // que acabou de mandar — aconteceu com os avisos da lista de espera, que
      // ficaram enterrados em setembro no meio de 792 conversas.
      await admin.from('conversations')
        .update({ last_message_at: agora })
        .eq('id', id);
    } else {
      const { data: criada, error: erroConv } = await admin
        .from('conversations')
        .upsert(
          {
            user_id: userId, customer_phone: telefone, channel: 'whatsapp',
            phone_number_id: phoneNumberId, customer_name: nome || null,
            last_message_at: agora,
          },
          { onConflict: 'user_id,channel,customer_phone,phone_number_id' },
        )
        .select('id').maybeSingle();
      if (erroConv) {
        console.error('[iniciar-conversa] upsert da conversa falhou:', erroConv.code, erroConv.message);
        return;
      }
      id = criada?.id ?? null;
    }

    if (!id) {
      console.error('[iniciar-conversa] conversa não resolvida — mensagem NÃO registrada');
      return;
    }

    // `wa_message_id` + `wa_status` dão os vistos de entregue/lido: o
    // whatsapp-webhook acha a linha por este id e sobe o status sozinho.
    const { error: erroMsg } = await admin.from('messages').insert({
      conversation_id: id, role: 'bot', content: texto,
      wa_message_id: waMessageId ?? null,
      wa_status: waMessageId ? 'sent' : null,
      // Marca que foi a LOJA falando primeiro, e não resposta do bot. É o que
      // põe isto na aba Disparos — não tem campanha, então `campaign_id`
      // sozinho nunca pegaria.
      envio_ativo: 'iniciada',
    });
    if (erroMsg) {
      console.error('[iniciar-conversa] insert da mensagem falhou:', erroMsg.code, erroMsg.message);
    }
  } catch (e) {
    // Registro é acessório: a mensagem já saiu e não deve ser desfeita.
    console.error('[iniciar-conversa] falha ao registrar:', e);
  }
}
