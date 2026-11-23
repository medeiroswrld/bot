import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { sendWhatsAppTemplate } from '../_shared/sendTemplate.ts';
import { resolveWhatsAppToken, variantesTelefoneBR } from '../_shared/whatsapp.ts';
import { maskPhone } from '../_shared/maskPII.ts';

import { buildCors } from '../_shared/cors.ts';
import { podeDisparar, COLUNAS_DISPARO } from '../_shared/botGuards.ts';

// Rate limit: ~1s entre envios pra não estourar o limite da Meta
const DELAY_BETWEEN_SENDS_MS = 1100;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;
interface Recipient {
  phone: string; name?: string | null; lead_id?: string | null;
  created_at?: string | null; client_type?: string | null;
  // Dados do agendamento, quando o público é `evento_agendados`. Existem para
  // o lembrete poder dizer o dia e a hora DAQUELA pessoa: sem isto, o disparo
  // preenche a mesma variável para todo mundo e quem marcou quinta receberia
  // "sábado às 14h".
  appointment_date?: string | null; appointment_time?: string | null;
}

serve(async (req) => {
  const corsHeaders = buildCors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { campaign_id } = await req.json();
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: 'campaign_id obrigatório' }), {
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

    // Campanha + template
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .select('*, template:template_id(*)')
      .eq('id', campaign_id)
      .single();

    if (campErr || !campaign) {
      return new Response(JSON.stringify({ error: 'Campanha não encontrada' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (campaign.template?.status !== 'approved') {
      return new Response(JSON.stringify({ error: 'Template não aprovado pela Meta', status: campaign.template?.status }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Phone Number ID vem de company_settings (multi-tenant)
    const { data: settings } = await supabase
      .from('company_settings')
      .select(`whatsapp_phone_number_id, ${COLUNAS_DISPARO}`)
      .eq('user_id', campaign.user_id)
      .single();

    // Plano sem disparo: existe cliente que compra so o CRM, e outro que compra
    // CRM + disparo sem bot. A trava e servidor — a tela pode esconder o botao,
    // mas a fronteira e aqui.
    if (!podeDisparar(settings)) {
      console.warn(`[campanha] bloqueada: plano sem disparo (user ${campaign.user_id})`);
      return new Response(JSON.stringify({ error: 'Envio em massa não faz parte do plano desta conta.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const phoneNumberId = String(settings?.whatsapp_phone_number_id ?? '');
    if (!phoneNumberId) {
      return new Response(JSON.stringify({ error: 'whatsapp_phone_number_id não configurado' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = await resolveWhatsAppToken(supabase, campaign.user_id);

    // ── Cabeçalho de mídia ────────────────────────────────────────────────
    //
    // Template com cabeçalho de IMAGEM/VÍDEO EXIGE o parâmetro do cabeçalho em
    // TODO envio: omitir faz a Meta recusar a mensagem, não enviar sem a foto.
    // Por isso o fallback pra imagem de exemplo do próprio template — assim um
    // template de imagem nunca sai sem imagem.
    //
    // A arte vem do DISPARO (`template_variables.header_image`), não da
    // aprovação. É o que faz um template aprovado servir todo feirão: troca a
    // imagem, não o template.
    const tipoCabecalho = String(campaign.template?.header_type ?? '').toUpperCase();
    const ehMidia = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(tipoCabecalho);
    const urlCabecalho = ehMidia
      ? String(campaign.template_variables?.header_image ?? campaign.template?.header_content ?? '').trim()
      : '';
    const headerParameters = ehMidia && urlCabecalho
      ? [{
          type: tipoCabecalho.toLowerCase(),
          [tipoCabecalho.toLowerCase()]: { link: urlCabecalho },
        } as unknown as { type: string }]
      : undefined;

    if (ehMidia && !urlCabecalho) {
      await supabase.from('campaigns')
        .update({ status: 'failed', completed_at: new Date().toISOString() })
        .eq('id', campaign_id);
      return new Response(JSON.stringify({
        error: 'Este template tem cabeçalho de mídia e nenhuma imagem foi informada. '
             + 'A Meta recusaria todas as mensagens — nada foi enviado.',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Lote e retomada ───────────────────────────────────────────────────
    //
    // 23/11: o "Convite Feirão" parou em 56 de 200 e a função devolveu HTTP
    // 546 — morta por limite de recurso. Cada envio custa 1,1s de pausa mais
    // quatro idas à rede, então 200 numa invocação só passa de 500s e o runtime
    // corta no meio. A campanha ficava `sending` PRA SEMPRE com 131 pessoas em
    // `pending`, sem erro nenhum na tela: ninguém descobriria sem abrir a
    // tabela. 56 × 2,6s ≈ 145s, que bate com o corte.
    //
    // Agora cada invocação manda UM LOTE e devolve quantas faltam; o cron
    // `continuar-campanhas` chama de novo até zerar. 30 × 2,6s ≈ 78s, com
    // folga confortável.
    const LOTE_ENVIO = 30;

    const { data: pendentes } = await supabase
      .from('campaign_sends')
      .select('id, customer_phone, customer_name')
      .eq('campaign_id', campaign_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(LOTE_ENVIO);

    // Retomando = já existem destinatários gravados esperando.
    //
    // Nesse caso o público NÃO é reconstruído, e isso é essencial: o teto
    // (`limite`) e o "quem já recebeu" dariam outra lista, e sobraria gente
    // pendente que não casa com ninguém do público novo — ficaria pendente pra
    // sempre, de novo em silêncio.
    const retomando = (pendentes?.length ?? 0) > 0;

    let recipients: Recipient[] = [];
    let sends: { id: string; customer_phone: string; customer_name: string | null }[] = [];

    if (retomando) {
      sends = pendentes!;
      recipients = sends.map((s) => ({ phone: s.customer_phone, name: s.customer_name ?? 'cliente' }));

      // O público do lembrete usa a data e a hora DAQUELA pessoa, e esses
      // campos não existem em campaign_sends. Sem relê-los, quem caísse no
      // segundo lote receberia o lembrete com a data em branco.
      if (campaign.audience_type === 'evento_agendados') {
        const { data: ags } = await supabase
          .from('appointments')
          .select('customer_phone, appointment_date, appointment_time')
          .eq('user_id', campaign.user_id)
          .in('customer_phone', sends.map((s) => s.customer_phone));
        for (const r of recipients) {
          const a = (ags ?? []).find((x: DB) => x.customer_phone === r.phone);
          if (a) { r.appointment_date = a.appointment_date; r.appointment_time = a.appointment_time; }
        }
      }

      console.log('[send-campaign] retomando campanha', { lote: sends.length });
    } else {
      const publicoBruto = await resolveAudience(supabase, campaign);
      const {
        lista, excluidosIdade, excluidosJaReceberam,
        excluidosDuplicados, excluidosPeloLimite, excluidosSemTelefone,
      } = await refinarPublico(supabase, campaign, publicoBruto);
      recipients = lista;

      console.log('[send-campaign] público', {
        bruto: publicoBruto.length, final: recipients.length,
        excluidosIdade, excluidosJaReceberam,
        // Estes dois são o que protege o número: repetido nunca sai duas vezes, e
        // o teto impede o disparo de uma base inteira num número recém-conectado.
        excluidosDuplicados, excluidosPeloLimite,
        // Quem nao tinha telefone de verdade (IGSID, lixo de importacao).
        excluidosSemTelefone,
      });

      if (recipients.length === 0) {
        await supabase.from('campaigns')
          .update({ status: 'completed', recipients_count: 0, completed_at: new Date().toISOString() })
          .eq('id', campaign_id);
        return new Response(JSON.stringify({ message: 'Nenhum destinatário', sent: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await supabase.from('campaigns')
        .update({ status: 'sending', started_at: new Date().toISOString(), recipients_count: recipients.length })
        .eq('id', campaign_id);

      const sendsRows = recipients.map((r) => ({
        campaign_id, customer_phone: r.phone, customer_name: r.name ?? null, lead_id: r.lead_id ?? null, status: 'pending',
      }));
      // customer_name entra no select porque o registro da conversa usa ele — sem
      // isso a conversa nascia como "Sem nome" mesmo com o lead nomeado.
      const { data: inseridos } = await supabase.from('campaign_sends')
        .insert(sendsRows).select('id, customer_phone, customer_name');

      // Só o primeiro lote sai agora. O resto fica `pending` e o cron pega.
      sends = (inseridos ?? []).slice(0, LOTE_ENVIO);
    }

    let sentCount = 0;
    let failedCount = 0;

    for (const send of sends ?? []) {
      try {
        const recipient = recipients.find((r) => r.phone === send.customer_phone);
        const bodyParameters = buildTemplateParameters(campaign.template_variables, recipient);

        const result = await sendWhatsAppTemplate({
          phone: send.customer_phone,
          templateName: campaign.template.meta_template_name,
          language: campaign.template.language,
          bodyParameters,
          headerParameters,
          phoneNumberId,
          token,
        });

        await supabase.from('campaign_sends')
          .update({ status: 'sent', whatsapp_message_id: result.messageId, sent_at: new Date().toISOString() })
          .eq('id', send.id);

        // Registra o disparo na conversa. Sem isso a campanha some do CRM (o
        // lojista não vê o que foi enviado) e, pior, quando o cliente responde
        // o bot começa o papo sem saber o que foi prometido a ele.
        await registrarDisparoNaConversa(supabase, {
          userId: campaign.user_id,
          phone: send.customer_phone,
          name: send.customer_name,
          texto: renderizarCorpo(campaign.template?.body_text, bodyParameters),
          campaignId: campaign_id,
          phoneNumberId,
          waMessageId: result.messageId,
        });
        sentCount++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[send-campaign] erro pra ${maskPhone(send.customer_phone)}:`, msg);
        await supabase.from('campaign_sends')
          .update({ status: 'failed', error_message: msg, failed_at: new Date().toISOString() })
          .eq('id', send.id);
        failedCount++;
      }
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_SENDS_MS));
    }

    // ── Fechamento ────────────────────────────────────────────────────────
    //
    // Os contadores são recontados da TABELA, não somados na memória. Com lote
    // + retomada, `sent_count: sentCount` sobrescreveria o total com o que saiu
    // só neste lote — foi por isso que a campanha de 23/11 mostrava "1 enviado"
    // na tela enquanto 56 pessoas já tinham recebido.
    const contar = async (st: string) => {
      const { count } = await supabase
        .from('campaign_sends')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaign_id)
        .eq('status', st);
      return count ?? 0;
    };

    const restantes = await contar('pending');
    const totalEnviados = (await contar('sent')) + (await contar('delivered')) + (await contar('read'));
    const totalFalhas   = await contar('failed');

    await supabase.from('campaigns')
      .update({
        status: restantes > 0 ? 'sending' : 'completed',
        sent_count: totalEnviados,
        failed_count: totalFalhas,
        ...(restantes > 0 ? {} : { completed_at: new Date().toISOString() }),
      })
      .eq('id', campaign_id);

    console.log('[send-campaign] lote concluido', {
      loteEnviado: sentCount, loteFalhas: failedCount, restantes, totalEnviados, totalFalhas,
    });

    return new Response(JSON.stringify({
      success: true,
      lote_enviado: sentCount,
      lote_falhas: failedCount,
      restantes,
      total_enviados: totalEnviados,
      total_falhas: totalFalhas,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[send-campaign] exception:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Corte entre cliente NOVO e ANTIGO, em dias desde o cadastro. Existe uma
// cópia disso em src/lib/leads.js (o front precisa contar antes de disparar).
// É um número só; duplicar aqui é mais seguro que o front mandar o corte e o
// servidor obedecer sem conferir.
const DIAS_CLIENTE_NOVO = 30;

/**
 * Refina o público já resolvido: idade do cadastro + quem já recebeu.
 *
 * Fica DEPOIS do resolveAudience de propósito — assim combina com qualquer
 * público ("base importada" + "só antigos" + "que ainda não recebeu o feirão")
 * sem multiplicar as opções da tela.
 */
async function refinarPublico(
  supabase: DB, campaign: DB, recipients: Recipient[],
): Promise<{
  lista: Recipient[];
  excluidosIdade: number;
  excluidosJaReceberam: number;
  excluidosDuplicados: number;
  excluidosPeloLimite: number;
  excluidosSemTelefone: number;
}> {
  const filter = campaign.audience_filter ?? {};
  let lista = recipients;
  let excluidosIdade = 0;

  // ── 0. MESMA PESSOA UMA VEZ SÓ ────────────────────────────────────────────
  //
  // Isto vem antes de tudo porque nenhum outro filtro protege contra ele. A
  // base de uma loja real tinha 1215 leads e 706 pessoas: 509 envios repetidos
  // concentrados em 11 números, sendo que UM aparecia 304 vezes. Sem este
  // passo, esse número receberia 304 mensagens de marketing no mesmo disparo —
  // o jeito mais rápido de ser denunciado e derrubar a qualidade do número, o
  // que cala o bot inteiro, não só a campanha.
  //
  // A comparação é por DÍGITOS. "(15) 99999-9999" e "5515999999999" são a mesma
  // pessoa, e comparar a string crua deixaria as duas passarem.
  const soDigitos = (p: unknown) => String(p ?? '').replace(/\D/g, '');

  // ── 0a. ISSO É UM TELEFONE? ───────────────────────────────────────────────
  //
  // Vem antes do dedup porque lixo não merece nem ser deduplicado.
  //
  // Lead de Instagram/Messenger guarda o PSID/IGSID no campo `phone` — é assim
  // que o sistema casa lead com conversa nesses canais. Mas IGSID tem 16-17
  // dígitos e NÃO é telefone: mandar WhatsApp pra ele é falha garantida, e
  // falha de envio machuca a qualidade do número. Num número recém-conectado
  // isso é o que não pode acontecer.
  //
  // Medido na base da DSC em 19/11: 17 leads com 16 dígitos (IGSIDs que
  // entraram pelo `registrar_interesse`) contra 1.201 com 12-13. Sem esta
  // guarda, um disparo de "todos os leads" levaria 17 falhas certas.
  //
  // 10 a 13 dígitos: fixo sem DDI (10), celular sem DDI (11), fixo com 55 (12),
  // celular com 55 (13).
  const PHONE_MIN = 10;
  const PHONE_MAX = 13;
  const antesFormato = lista.length;
  lista = lista.filter((r) => {
    const d = soDigitos(r.phone);
    return d.length >= PHONE_MIN && d.length <= PHONE_MAX;
  });
  const excluidosSemTelefone = antesFormato - lista.length;

  const vistos = new Set<string>();
  const antesDedup = lista.length;
  lista = lista.filter((r) => {
    const chave = soDigitos(r.phone);
    if (!chave) return false;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
  const excluidosDuplicados = antesDedup - lista.length;

  // 1. Idade do cadastro. Só vale pra público vindo de `leads` — lista de
  //    espera e números avulsos não têm data de cadastro, então passam direto.
  const idade = filter.idade ?? 'todos';
  if (idade === 'novos' || idade === 'antigos') {
    const corte = Date.now() - DIAS_CLIENTE_NOVO * 86400000;
    const antes = lista.length;
    lista = lista.filter((r) => {
      // Classificação manual (vem da importação) manda sobre a data.
      if (r.client_type === 'novo' || r.client_type === 'antigo') {
        return idade === 'novos' ? r.client_type === 'novo' : r.client_type === 'antigo';
      }
      if (!r.created_at) return true;
      const nasceu = new Date(r.created_at).getTime();
      return idade === 'novos' ? nasceu >= corte : nasceu < corte;
    });
    excluidosIdade = antes - lista.length;
  }

  // 2. Quem já recebeu. O histórico já existe em campaign_sends; o que faltava
  //    era usar. "este_template" é o caso do dia a dia (mandei 10 hoje, mando
  //    os outros 10 amanhã); "qualquer" é trava de fadiga, pra não bombardear
  //    a mesma pessoa com reativação hoje e feirão depois de amanhã.
  const excluir = filter.excluir_ja_recebeu ?? 'nenhum';
  let excluidosJaReceberam = 0;

  if (excluir === 'este_template' || excluir === 'qualquer') {
    let cq = supabase.from('campaigns').select('id').eq('user_id', campaign.user_id);
    if (excluir === 'este_template') cq = cq.eq('template_id', campaign.template_id);
    const { data: camps } = await cq;
    const ids = (camps ?? []).map((c: DB) => c.id).filter((id: string) => id !== campaign.id);

    if (ids.length) {
      let sq = supabase.from('campaign_sends')
        .select('customer_phone').in('campaign_id', ids).eq('status', 'sent');
      if (excluir === 'qualquer') {
        const dias = Number(filter.excluir_dias) || 7;
        sq = sq.gte('sent_at', new Date(Date.now() - dias * 86400000).toISOString());
      }
      const { data: enviados } = await sq;
      const jaReceberam = new Set((enviados ?? []).map((s: DB) => String(s.customer_phone)));
      const antes = lista.length;
      // Também por dígitos: o histórico guarda o telefone como foi enviado, e
      // comparar string crua deixaria a mesma pessoa receber de novo só porque
      // o cadastro dela tem a máscara diferente.
      const jaNormalizado = new Set([...jaReceberam].map(soDigitos));
      lista = lista.filter((r) => !jaNormalizado.has(soDigitos(r.phone)));
      excluidosJaReceberam = antes - lista.length;
    }
  }

  // ── 4. TETO POR DISPARO ───────────────────────────────────────────────────
  //
  // `audience_filter.limite` (não precisa de coluna: o campo já é JSONB).
  //
  // Existe por causa do número NOVO. Um número recém-conectado começa no menor
  // degrau da Meta: **250 conversas iniciadas pela empresa por 24h**. Uma base
  // de 706 pessoas não só estoura o teto — mandar tudo de uma vez num número de
  // poucos dias é o padrão clássico de banimento, e as falhas por limite
  // estourado ainda machucam a qualidade do número.
  //
  // Com o teto, o lojista aquece: manda 100 hoje, 100 amanhã, e usa
  // `excluir_ja_recebeu` pra não repetir quem já recebeu. A ordem é preservada,
  // então lotes consecutivos avançam na lista em vez de sortear de novo.
  const limite = Number(filter.limite) || 0;
  let excluidosPeloLimite = 0;
  if (limite > 0 && lista.length > limite) {
    excluidosPeloLimite = lista.length - limite;
    lista = lista.slice(0, limite);
  }

  return {
    lista, excluidosIdade, excluidosJaReceberam,
    excluidosDuplicados, excluidosPeloLimite, excluidosSemTelefone,
  };
}

async function resolveAudience(supabase: DB, campaign: DB): Promise<Recipient[]> {
  const filter = campaign.audience_filter ?? {};
  const uid = campaign.user_id;
  const mapLeads = (data: DB[]) => (data ?? []).map((l) => ({
    phone: l.phone, name: l.name, lead_id: l.id,
    created_at: l.created_at, client_type: l.client_type,
  }));

  switch (campaign.audience_type) {
    case 'all_leads': {
      const { data } = await supabase.from('leads').select('id, name, phone, created_at, client_type').eq('user_id', uid).not('phone', 'is', null);
      return mapLeads(data);
    }
    case 'leads_by_status': {
      const statuses = filter.statuses ?? [];
      const { data } = await supabase.from('leads').select('id, name, phone, created_at, client_type').eq('user_id', uid).in('status', statuses).not('phone', 'is', null);
      return mapLeads(data);
    }
    case 'leads_inactive': {
      const days = filter.days_inactive ?? 30;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const { data } = await supabase.from('leads').select('id, name, phone, created_at, client_type').eq('user_id', uid).lt('updated_at', cutoff).not('phone', 'is', null);
      return mapLeads(data);
    }
    case 'leads_by_interest_vehicle': {
      const model = filter.model ?? '';
      const { data } = await supabase.from('vehicle_interests')
        .select('customer_phone, customer_name, lead_id')
        .eq('user_id', uid).eq('status', 'active').ilike('model', `%${model}%`);
      return (data ?? []).map((v: DB) => ({ phone: v.customer_phone, name: v.customer_name, lead_id: v.lead_id }));
    }
    // Quem tem VISITA MARCADA num evento (feirão). É o público do lembrete:
    // gente que já se comprometeu a aparecer, não gente que talvez queira.
    //
    // Lê `appointments.evento_id`, que o bot grava sozinho quando a data cai
    // dentro do evento (migration 117). `filter.evento_id` escolhe o evento;
    // sem ele, pega qualquer visita de qualquer evento ainda não cancelada.
    //
    // O nome vem do próprio agendamento, não do lead: quem marca visita informa
    // o nome ao bot, e é esse que o cliente espera ver na mensagem.
    case 'evento_agendados': {
      let aq = supabase.from('appointments')
        .select('customer_phone, customer_name, appointment_date, appointment_time')
        .eq('user_id', uid)
        .not('evento_id', 'is', null)
        .not('customer_phone', 'is', null)
        .in('status', ['scheduled', 'confirmed']);
      if (filter.evento_id) aq = aq.eq('evento_id', filter.evento_id);
      // Só as visitas que ainda vão acontecer, quando pedido — lembrete de
      // visita que já passou é ruído.
      if (filter.so_futuras) aq = aq.gte('appointment_date', new Date().toISOString().slice(0, 10));
      aq = aq.order('appointment_date', { ascending: true });
      const { data, error } = await aq;
      if (error) {
        // Banco sem a migration 117 não tem a coluna. Devolver vazio é melhor
        // que estourar: a campanha termina como "nenhum destinatário" em vez de
        // falhar no meio.
        console.warn('[send-campaign] evento_agendados indisponível:', error.message);
        return [];
      }
      return (data ?? []).map((a: DB) => ({
        phone: a.customer_phone, name: a.customer_name, lead_id: null,
        appointment_date: a.appointment_date, appointment_time: a.appointment_time,
      }));
    }
    case 'custom_phones': {
      const phones = filter.phones ?? [];
      return phones.map((p: string) => ({ phone: String(p).replace(/\D/g, '') })).filter((r: Recipient) => r.phone);
    }
    // Base antiga importada pelo lojista. Fica separada dos leads que o bot
    // gerou pra dar pra disparar só pra ela — que é o motivo da importação.
    case 'leads_by_source': {
      const sources = filter.sources ?? ['importacao'];
      const { data } = await supabase.from('leads').select('id, name, phone, created_at, client_type')
        .eq('user_id', uid).in('source', sources).not('phone', 'is', null);
      return mapLeads(data);
    }
    default:
      return [];
  }
}

// Reconstrói o texto que o cliente REALMENTE recebeu, trocando {{1}}, {{2}}…
// pelos valores enviados à Meta — é isso que vai pro histórico da conversa.
function renderizarCorpo(bodyText: string | null | undefined, params: { text: string }[]): string {
  const base = String(bodyText ?? '').trim();
  if (!base) return '[campanha enviada]';
  return base.replace(/\{\{(\d+)\}\}/g, (_m, n) => params[Number(n) - 1]?.text ?? '');
}

async function registrarDisparoNaConversa(
  supabase: DB,
  { userId, phone, name, texto, campaignId, phoneNumberId, waMessageId }: {
    userId: string; phone: string; name?: string | null; texto: string;
    campaignId: string; phoneNumberId: string; waMessageId?: string | null;
  },
) {
  try {
    const agora = new Date().toISOString();

    // Procura primeiro pelas duas formas do número (com e sem o nono dígito):
    // a pessoa pode já ter conversado pelo WhatsApp, e aí a Meta gravou no
    // formato dela. Sem isso o disparo abriria uma segunda conversa pra quem
    // já é cliente conhecido.
    const variantes = variantesTelefoneBR(phone);
    let convId: string | null = null;

    if (variantes.length > 1) {
      const { data: existente } = await supabase
        .from('conversations')
        .select('id')
        .eq('user_id', userId)
        .in('customer_phone', variantes)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (existente?.id) {
        convId = existente.id;
        await supabase.from('conversations')
          .update({ last_message_at: agora }).eq('id', existente.id);
      }
    }

    // onConflict TEM que casar o índice único inteiro.
    //
    // O índice é `(user_id, channel, customer_phone, phone_number_id)`, quatro
    // colunas. Com `user_id,customer_phone` o Postgres devolve 42P10 ("no
    // unique or exclusion constraint matching the ON CONFLICT specification"),
    // o upsert não grava nada e — como supabase-js NÃO lança, devolve
    // `{data, error}` — o `conv?.id` saía undefined e o insert da mensagem era
    // simplesmente pulado. Sem exceção, sem log, sem sintoma.
    //
    // Custo real, medido em 23/11: de 174 disparos entregues, só 10 apareceram
    // nas Conversas — e justamente os 10 que já tinham conversa aberta, que nem
    // passam por aqui. Os outros 164 chegaram no WhatsApp do cliente e o bot
    // não fazia ideia do que tinha sido prometido quando ele respondesse.
    let conv: { id: string } | null = convId ? { id: convId } : null;

    if (!conv) {
      const { data: criada, error: erroConv } = await supabase
        .from('conversations')
        .upsert(
          {
            user_id: userId,
            customer_phone: phone,
            channel: 'whatsapp',
            phone_number_id: phoneNumberId,
            customer_name: name || null,
            last_message_at: agora,
          },
          { onConflict: 'user_id,channel,customer_phone,phone_number_id' },
        )
        .select('id')
        .maybeSingle();

      // O erro do upsert era descartado. Agora é alto: foi o silêncio dele que
      // escondeu 164 disparos fora do CRM.
      if (erroConv) {
        console.error('[send-campaign] upsert da conversa falhou:', erroConv.code, erroConv.message);
        return;
      }
      conv = criada ?? null;
    }

    if (!conv?.id) {
      console.error('[send-campaign] conversa nao resolvida para o disparo — mensagem NAO registrada');
      return;
    }

    // `wa_message_id` + `wa_status` são o que faz o disparo ganhar os vistos.
    //
    // Não precisa de máquina nova: o whatsapp-webhook já recebe os `statuses`
    // da Meta, acha a linha POR ESTE id e sobe `wa_status` pra delivered/read
    // (com guarda de ordem, pra status atrasado não rebaixar). Sem gravar o id
    // aqui, a mensagem do disparo era a única da conversa sem visto nenhum —
    // e o lojista não tinha como saber se chegou.
    const { error: erroMsg } = await supabase.from('messages').insert({
      conversation_id: conv.id,
      role: 'bot',
      content: texto,
      campaign_id: campaignId,
      wa_message_id: waMessageId ?? null,
      wa_status: waMessageId ? 'sent' : null,
    });
    if (erroMsg) {
      console.error('[send-campaign] insert da mensagem do disparo falhou:', erroMsg.code, erroMsg.message);
    }
  } catch (e) {
    // Registro é acessório: se falhar, o disparo já saiu e não deve ser desfeito.
    console.error('[send-campaign] falha ao registrar disparo na conversa:', e);
  }
}

// "2026-11-28" -> "sábado, 28/11". O cliente marcou "sábado"; mandar só
// "28/11" obriga ele a ir no calendário pra saber se é hoje ou amanhã.
const DIAS_SEM = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
function dataPorExtenso(iso?: string | null): string {
  const s = String(iso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(`${s}T12:00:00Z`);     // meio-dia UTC: imune a fuso
  const [, mes, dia] = s.split('-');
  return `${DIAS_SEM[d.getUTCDay()]}, ${dia}/${mes}`;
}

// "14:00:00" -> "14h"; "14:30:00" -> "14h30"
function horaCurta(t?: string | null): string {
  const s = String(t ?? '').slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(s)) return '';
  const [h, m] = s.split(':');
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
}

function buildTemplateParameters(templateVars: DB, recipient: DB): { type: 'text'; text: string }[] {
  const params: { type: 'text'; text: string }[] = [];
  if (!templateVars) return params;
  // SÓ as chaves numéricas. `template_variables` guarda as variáveis do corpo
  // por posição ("1", "2", …), e agora também `header_image`, que não é
  // variável de corpo nenhuma. Sem este filtro ela entraria na lista de
  // parâmetros (parseInt('header_image') = NaN, que a ordenação não descarta) e
  // o corpo sairia com um parâmetro a mais — a Meta recusa a mensagem inteira.
  const keys = Object.keys(templateVars)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => parseInt(a) - parseInt(b));
  for (const key of keys) {
    let value = templateVars[key];
    if (typeof value === 'string') {
      const fullName = recipient?.name ?? 'cliente';
      value = value
        .replace(/\{\{nome_cliente\}\}/g, fullName)
        .replace(/\{\{primeiro_nome\}\}/g, String(fullName).split(' ')[0])
        // Dia e hora DA PESSOA, do agendamento dela (público evento_agendados).
        // Sem estes dois, o lembrete sairia com a mesma data para todo mundo:
        // quem marcou quinta receberia "sábado às 14h" e apareceria no dia
        // errado. É o tipo de erro que o cliente não perdoa.
        .replace(/\{\{data_visita\}\}/g, dataPorExtenso(recipient?.appointment_date))
        .replace(/\{\{hora_visita\}\}/g, horaCurta(recipient?.appointment_time));
    }
    params.push({ type: 'text', text: String(value) });
  }
  return params;
}
