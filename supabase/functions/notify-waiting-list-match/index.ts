import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { sendWhatsAppTemplate } from '../_shared/sendTemplate.ts';
import { resolveWhatsAppToken, variantesTelefoneBR } from '../_shared/whatsapp.ts';
import { maskPhone } from '../_shared/maskPII.ts';

import { buildCors } from '../_shared/cors.ts';
import { dinheiro, numero } from '../_shared/dinheiro.ts';


// Troca {{1}}, {{2}}… pelos valores que foram realmente enviados.
// É o texto que o cliente leu — é ele que precisa ficar na conversa, não o
// template cru com as chaves.
function renderizarCorpo(body: string | null | undefined, params: Array<{ text?: string }>): string {
  let texto = String(body ?? '');
  params.forEach((p, i) => {
    texto = texto.replaceAll(`{{${i + 1}}}`, String(p?.text ?? ''));
  });
  return texto;
}

/**
 * Registra o aviso na conversa do cliente.
 *
 * POR QUE ISTO EXISTE:
 * em 24/11 a loja avisou 6 pessoas da lista de espera e NADA apareceu no CRM —
 * nem nas Conversas, nem na aba Disparos. As mensagens chegaram no WhatsApp do
 * cliente e o sistema não sabia de nenhuma.
 *
 * Pior que não aparecer na tela: o BOT não sabia. Quando a pessoa responde
 * "qual é mesmo o carro?", ele não tem o que foi prometido a ela. Mesmo
 * defeito que o disparo tinha, em outra porta.
 *
 * O `onConflict` leva as QUATRO colunas do índice único
 * (user_id, channel, customer_phone, phone_number_id). Com duas, o Postgres
 * devolve 42P10, o supabase-js NÃO lança (devolve {data, error}) e a gravação
 * falha em silêncio — foi exatamente assim que o disparo perdeu 164 mensagens.
 */
async function registrarAvisoNaConversa(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  { userId, phone, name, texto, phoneNumberId, waMessageId }: {
    userId: string; phone: string; name?: string | null; texto: string;
    phoneNumberId: string; waMessageId?: string | null;
  },
) {
  try {
    const agora = new Date().toISOString();

    // Procura primeiro pelas duas formas do número (com e sem o nono dígito):
    // quem já conversou tem a conversa gravada no formato que a Meta mandou, e
    // sem isto o aviso abriria uma segunda conversa pra cliente conhecido.
    let convId: string | null = null;
    const variantes = variantesTelefoneBR(phone);
    if (variantes.length > 1) {
      const { data: existente } = await supabase
        .from('conversations').select('id')
        .eq('user_id', userId).in('customer_phone', variantes)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1).maybeSingle();
      if (existente?.id) {
        convId = existente.id;
        await supabase.from('conversations').update({ last_message_at: agora }).eq('id', existente.id);
      }
    }

    let conv: { id: string } | null = convId ? { id: convId } : null;

    if (!conv) {
      const { data: criada, error: erroConv } = await supabase
        .from('conversations')
        .upsert(
          {
            user_id: userId, customer_phone: phone, channel: 'whatsapp',
            phone_number_id: phoneNumberId, customer_name: name || null, last_message_at: agora,
          },
          { onConflict: 'user_id,channel,customer_phone,phone_number_id' },
        )
        .select('id').maybeSingle();

      if (erroConv) {
        console.error('[notify-waiting-list] upsert da conversa falhou:', erroConv.code, erroConv.message);
        return;
      }
      conv = criada ?? null;
    }

    if (!conv?.id) {
      console.error('[notify-waiting-list] conversa nao resolvida — aviso NAO registrado');
      return;
    }

    // `wa_message_id` + `wa_status` dão os vistos de entregue/lido: o
    // whatsapp-webhook acha a linha por este id e sobe o status sozinho.
    const { error: erroMsg } = await supabase.from('messages').insert({
      conversation_id: conv.id, role: 'bot', content: texto,
      wa_message_id: waMessageId ?? null,
      wa_status: waMessageId ? 'sent' : null,
    });
    if (erroMsg) {
      console.error('[notify-waiting-list] insert da mensagem falhou:', erroMsg.code, erroMsg.message);
    }
  } catch (e) {
    // Registro é acessório: o aviso já saiu e não deve ser desfeito.
    console.error('[notify-waiting-list] falha ao registrar na conversa:', e);
  }
}

serve(async (req) => {
  const corsHeaders = buildCors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { car_id, interest_ids, auto } = await req.json();
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
        // Colunas explicitas, NUNCA select('*'). Estas funcoes montam mensagem que
    // vai pro CLIENTE, e a tabela cars guarda o que a loja pagou
    // (purchase_price), chassi, renavam e dados do comprador. Com '*' basta
    // alguem interpolar o objeto inteiro, ou uma coluna sensivel nova
    // aparecer, pra vazar - e vazar quanto a loja pagou destroi a negociacao.
    const { data: car } = await supabase.from('cars').select('id, user_id, brand, model, version, year, price, mileage, transmission, fuel, color, vehicle_type, status').eq('id', car_id).single();
    if (!car) {
      return new Response(JSON.stringify({ error: 'Carro não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const carName = [car.brand, car.model, car.version].filter(Boolean).join(' ');

    // Settings (template + phone + nome empresa) da empresa dona do carro
    const { data: settings } = await supabase
      .from('company_settings')
      .select('whatsapp_phone_number_id, waiting_list_template_id, company_name, moeda, locale')
      .eq('user_id', car.user_id)
      .single();

    // Montada aqui, e nao junto do `carName`, porque precisa da moeda da loja.
    // `Math.round` no preco mantem a saida brasileira igual a de antes, quando
    // o helper local fixava `maximumFractionDigits: 0`.
    const carDescription = `${carName} ${car.year}, `
      + `${numero(car.mileage || 0, settings?.locale)} km, `
      + `${dinheiro(Math.round(Number(car.price) || 0), settings?.moeda, settings?.locale)}`;

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
    const token = await resolveWhatsAppToken(supabase, car.user_id);

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
        console.log('[notify-waiting-list] enviando para', maskPhone(interest.customer_phone), 'modelo:', interest.model);
        // 4 variáveis: primeiro_nome, modelo_procurado, nome_empresa, descricao_carro
        const bodyParameters = [
          { type: 'text', text: firstName },
          { type: 'text', text: String(interest.model ?? 'veículo') },
          { type: 'text', text: companyName },
          { type: 'text', text: carDescription },
        ];

        const envio = await sendWhatsAppTemplate({
          phone: interest.customer_phone,
          templateName: template.meta_template_name,
          language: template.language,
          bodyParameters,
          phoneNumberId,
          token,
        });

        // O aviso entra na conversa do cliente. Sem isto ele some do CRM — e,
        // pior, o bot atende a resposta sem saber o que foi prometido.
        await registrarAvisoNaConversa(supabase, {
          userId: car.user_id,
          phone: interest.customer_phone,
          name: interest.customer_name,
          texto: renderizarCorpo(template.body_text, bodyParameters),
          phoneNumberId,
          waMessageId: envio?.messageId ?? null,
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
        console.error('[notify-waiting-list] erro pra', maskPhone(interest.customer_phone), msg);
        // Não trava os outros — registra o erro nas notes do interesse
        const errLine = `[aviso falhou ${new Date().toISOString()}] ${msg}`.slice(0, 300);
        const newNotes = interest.notes ? `${interest.notes}\n${errLine}` : errLine;
        await supabase.from('vehicle_interests').update({ notes: newNotes }).eq('id', interest.id);
        failed++;
      }
      await new Promise((r) => setTimeout(r, 1100));
    }

    if (auto) console.log(`[auto-notify] car=${car_id} sent=${sent} failed=${failed}`);
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
