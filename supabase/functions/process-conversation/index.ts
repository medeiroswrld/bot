import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { sendMessage, sendImage } from '../_shared/whatsapp.ts';

// ─── tipos locais ─────────────────────────────────────────────────────────────

interface ClaudeContentBlock {
  type: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  text?: string
}

interface ClaudeResponse {
  id: string
  type: string
  stop_reason: string
  content: ClaudeContentBlock[]
}

// ─── Supabase admin ───────────────────────────────────────────────────────────

function initAdmin() {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ─── utilidades de data/hora ──────────────────────────────────────────────────

function generateTimeSlots(
  startTime: string,
  endTime: string,
  durationMin: number,
  intervalMin: number,
): string[] {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let cur = sh * 60 + sm;
  const end = eh * 60 + em;
  const slots: string[] = [];
  while (cur + durationMin <= end) {
    const h = Math.floor(cur / 60);
    const m = cur % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    cur += durationMin + intervalMin;
  }
  return slots;
}

// Retorna data e hora atual no fuso de Brasília
function getBrazilDateInfo(): { label: string; iso: string } {
  const now = new Date();

  // ISO date no fuso América/São Paulo (sv-SE usa formato YYYY-MM-DD)
  const iso = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(now);

  // Rótulo legível: "sexta-feira, 23/05/2026"
  const label = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now);

  return { label, iso };
}

// ─── mescla mensagens consecutivas do mesmo papel ────────────────────────────

function mergeConsecutiveRoles(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!messages.length) return messages;
  const merged: Array<{ role: 'user' | 'assistant'; content: string }> = [{ ...messages[0] }];
  for (let i = 1; i < messages.length; i++) {
    const last = merged[merged.length - 1];
    if (last.role === messages[i].role) {
      last.content += '\n' + messages[i].content;
    } else {
      merged.push({ ...messages[i] });
    }
  }
  return merged;
}

// ─── definição das ferramentas ────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'consultar_estoque',
    description:
      'Busca veículos disponíveis no estoque da concessionária — carros e motos. Use sempre que o cliente perguntar sobre veículos, preços, disponibilidade ou características.',
    input_schema: {
      type: 'object',
      properties: {
        marca:     { type: 'string',  description: 'Marca do veículo (ex.: Toyota, Honda, Yamaha)' },
        modelo:    { type: 'string',  description: 'Modelo do veículo (ex.: Corolla, Civic, MT-07)' },
        preco_max: { type: 'number',  description: 'Preço máximo em reais' },
        ano_min:   { type: 'integer', description: 'Ano mínimo de fabricação' },
        tipo:      { type: 'string',  description: 'Tipo de veículo: "carro" ou "moto"' },
      },
      required: [],
    },
  },
  {
    name: 'ver_horarios_disponiveis',
    description:
      'Retorna os horários de visita disponíveis para uma data específica. Use antes de propor um agendamento.',
    input_schema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'Data no formato YYYY-MM-DD' },
      },
      required: ['data'],
    },
  },
  {
    name: 'agendar_visita',
    description:
      'Agenda uma visita na concessionária. Use somente após confirmar data e horário com o cliente.',
    input_schema: {
      type: 'object',
      properties: {
        nome_cliente: { type: 'string', description: 'Nome do cliente' },
        data:         { type: 'string', description: 'Data no formato YYYY-MM-DD' },
        horario:      { type: 'string', description: 'Horário no formato HH:MM' },
        car_id:       { type: 'string', description: 'ID do veículo de interesse (opcional)' },
      },
      required: ['nome_cliente', 'data', 'horario'],
    },
  },
  {
    name: 'registrar_interesse',
    description:
      'Registra ou atualiza o lead do cliente quando ele demonstra intenção de compra ou pede contato.',
    input_schema: {
      type: 'object',
      properties: {
        nome:       { type: 'string', description: 'Nome do cliente (opcional se já conhecido)' },
        car_id:     { type: 'string', description: 'ID do veículo de interesse (opcional)' },
        observacao: { type: 'string', description: 'Observação sobre o interesse do cliente' },
      },
      required: ['observacao'],
    },
  },
  {
    name: 'salvar_nome_cliente',
    description:
      'Salva o nome do cliente na conversa. Use imediatamente quando o cliente informar o próprio nome.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome que o cliente informou' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'coletar_dados_financiamento',
    description:
      'Coleta os dados necessários para simulação de financiamento e registra no lead. Use após obter: nome completo, veículo de interesse, valor de entrada e prazo em meses.',
    input_schema: {
      type: 'object',
      properties: {
        nome_completo:  { type: 'string',  description: 'Nome completo do cliente' },
        veiculo_id:     { type: 'string',  description: 'ID do veículo de interesse (do consultar_estoque)' },
        valor_entrada:  { type: 'number',  description: 'Valor de entrada em reais' },
        prazo_meses:    { type: 'integer', description: 'Prazo desejado em meses (ex: 24, 36, 48, 60)' },
      },
      required: ['nome_completo', 'valor_entrada', 'prazo_meses'],
    },
  },
  {
    name: 'chamar_atendente',
    description:
      'Chama um atendente humano. Use quando: (1) o cliente pedir explicitamente, (2) a conversa envolver preço, desconto ou negociação, (3) você não conseguir resolver a dúvida, ou (4) após coletar dados de financiamento.',
    input_schema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Motivo resumido (ex.: simulação de financiamento solicitada)' },
      },
      required: ['motivo'],
    },
  },
  {
    name: 'enviar_foto_carro',
    description:
      'Envia a foto de um carro pelo WhatsApp. Use quando o cliente aceitar receber uma foto de um veículo específico do estoque. O car_id DEVE ser exatamente um id retornado pela ferramenta consultar_estoque. NÃO invente, NÃO use ID parcial.',
    input_schema: {
      type: 'object',
      properties: {
        car_id: { type: 'string', description: 'ID exato do carro retornado pelo consultar_estoque' },
      },
      required: ['car_id'],
    },
  },
]

// ─── execução das ferramentas ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = ReturnType<typeof createClient<any>>

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { userId: string; conversationId: string; customerPhone: string; customerName: string | null; phoneNumberId: string },
  supabase: SupabaseClient,
): Promise<unknown> {
  const { userId, conversationId, customerPhone, customerName, phoneNumberId } = ctx;

  if (name === 'consultar_estoque') {
    let query = supabase
      .from('cars')
      .select('id, brand, model, version, year, price, mileage, transmission, fuel, color, vehicle_type, status, car_images(id)')
      .eq('user_id', userId)
      .in('status', ['available', 'reserved'])
      .order('price', { ascending: true })
      .limit(10);

    if (input.marca)     query = query.ilike('brand', `%${input.marca}%`);
    if (input.modelo)    query = query.ilike('model', `%${input.modelo}%`);
    if (input.preco_max) query = query.lte('price', Number(input.preco_max));
    if (input.ano_min)   query = query.gte('year',  Number(input.ano_min));
    if (input.tipo)      query = query.eq('vehicle_type', String(input.tipo));

    const { data, error } = await query;
    if (error) return { erro: 'Falha ao buscar estoque' };
    if (!data?.length) return { mensagem: 'Nenhum veículo encontrado com esses critérios.' };

    return {
      total: data.length,
      veiculos: data.map((c) => ({
        id: c.id,
        marca: c.brand,
        modelo: c.model,
        versao: c.version,
        ano: c.year,
        preco: c.price,
        km: c.mileage,
        cambio: c.transmission,
        combustivel: c.fuel,
        cor: c.color,
        tipo: (c.vehicle_type as string) === 'moto' ? 'moto' : 'carro',
        status: c.status === 'available' ? 'disponível' : 'reservado',
        fotos: Array.isArray(c.car_images) ? c.car_images.length : 0,
      })),
    };
  }

  if (name === 'ver_horarios_disponiveis') {
    const dateStr = String(input.data ?? '');
    if (!dateStr) return { erro: 'Data não fornecida' };

    const DOW_KEYS   = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
    const DOW_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const dateObj    = new Date(`${dateStr}T12:00:00Z`);
    const dayKey     = DOW_KEYS[dateObj.getUTCDay()];
    const dayLabel   = DOW_LABELS[dateObj.getUTCDay()];

    const { data: settings } = await supabase
      .from('company_settings')
      .select('business_hours, appointment_duration, appointment_interval, max_appointments_per_slot')
      .eq('user_id', userId)
      .single();

    // Verifica exceção para esta data (feriado ou horário especial)
    const { data: exception } = await supabase
      .from('schedule_exceptions')
      .select('closed, start_time, end_time, note')
      .eq('user_id', userId)
      .eq('date', dateStr)
      .maybeSingle();

    let slotStart: string;
    let slotEnd: string;

    if (exception) {
      if (exception.closed) {
        // Item 8: retorna estrutura closed com reason para o bot informar ao cliente
        return {
          closed: true,
          reason: exception.note || 'Loja fechada nesse dia',
          mensagem: `A concessionária está fechada em ${dateStr}. Tente outro dia.`,
        };
      }
      slotStart = String(exception.start_time ?? '09:00');
      slotEnd   = String(exception.end_time   ?? '18:00');
    } else {
      type DayHours = { open?: boolean; start?: string; end?: string };
      const bh = settings?.business_hours as Record<string, DayHours> | null;
      const dayHours = bh?.[dayKey];
      if (!dayHours?.open) {
        return { disponivel: false, mensagem: `A concessionária não funciona às ${dayLabel}. Tente outro dia.` };
      }
      slotStart = dayHours.start ?? '09:00';
      slotEnd   = dayHours.end   ?? '18:00';
    }

    const duration = Number(settings?.appointment_duration ?? 60);
    const interval = Number(settings?.appointment_interval ?? 15);
    const slots = generateTimeSlots(slotStart, slotEnd, duration, interval);

    const maxPerSlot = Number(settings?.max_appointments_per_slot ?? 1);

    const { data: existingAppts } = await supabase
      .from('appointments')
      .select('appointment_time')
      .eq('user_id', userId)
      .eq('appointment_date', dateStr)
      .neq('status', 'cancelled');

    const slotCount = new Map<string, number>();
    for (const a of (existingAppts ?? [])) {
      const t = String(a.appointment_time).substring(0, 5);
      slotCount.set(t, (slotCount.get(t) ?? 0) + 1);
    }
    const free = slots.filter((s) => (slotCount.get(s) ?? 0) < maxPerSlot);

    return { data: dateStr, dia_semana: dayLabel, horarios_livres: free, total_disponivel: free.length };
  }

  if (name === 'agendar_visita') {
    const dateStr     = String(input.data    ?? '');
    const horario     = String(input.horario ?? '');
    const nomeCliente = String(input.nome_cliente ?? customerName ?? 'Cliente');
    const carId       = input.car_id ? String(input.car_id) : null;

    const { data: conflict } = await supabase
      .from('appointments')
      .select('id')
      .eq('user_id', userId)
      .eq('appointment_date', dateStr)
      .eq('appointment_time', horario)
      .neq('status', 'cancelled')
      .maybeSingle();

    if (conflict) {
      return { sucesso: false, mensagem: 'Este horário não está mais disponível. Escolha outro horário.' };
    }

    const { data: settings } = await supabase
      .from('company_settings')
      .select('booking_mode')
      .eq('user_id', userId)
      .single();

    const appointmentStatus = settings?.booking_mode === 'confirm' ? 'scheduled' : 'confirmed';

    const { data: appt, error } = await supabase
      .from('appointments')
      .insert({
        user_id: userId,
        customer_name: nomeCliente,
        customer_phone: customerPhone,
        appointment_date: dateStr,
        appointment_time: horario,
        car_id: carId,
        status: appointmentStatus,
      })
      .select()
      .single();

    if (error) return { sucesso: false, mensagem: 'Erro ao criar agendamento.' };

    return {
      sucesso: true,
      id: appt.id,
      data: dateStr,
      horario,
      status: appointmentStatus,
      mensagem: appointmentStatus === 'confirmed'
        ? `Visita confirmada para ${dateStr} às ${horario}.`
        : `Visita solicitada para ${dateStr} às ${horario}. Aguardando confirmação da concessionária.`,
    };
  }

  if (name === 'registrar_interesse') {
    const nome       = input.nome ? String(input.nome) : (customerName ?? 'Cliente WhatsApp');
    const carId      = input.car_id ? String(input.car_id) : null;
    const observacao = String(input.observacao ?? '');

    const { data: existing } = await supabase
      .from('leads')
      .select('id')
      .eq('user_id', userId)
      .eq('phone', customerPhone)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('leads')
        .update({
          notes: observacao,
          updated_at: new Date().toISOString(),
          ...(input.nome ? { name: nome } : {}),
          ...(carId      ? { car_id: carId } : {}),
        })
        .eq('id', existing.id);
      return { sucesso: true, acao: 'atualizado', lead_id: existing.id };
    }

    const { data: newLead } = await supabase
      .from('leads')
      .insert({ user_id: userId, name: nome, phone: customerPhone, car_id: carId, notes: observacao, status: 'novo' })
      .select()
      .single();

    return { sucesso: true, acao: 'criado', lead_id: newLead?.id };
  }

  // Item 2: salva nome do cliente na conversa e no lead
  if (name === 'salvar_nome_cliente') {
    const nome = String(input.nome ?? '').trim();
    if (!nome) return { sucesso: false, mensagem: 'Nome vazio.' };

    // Atualiza o customer_name na conversa
    await supabase
      .from('conversations')
      .update({ customer_name: nome })
      .eq('id', conversationId);

    // Atualiza também o lead se existir
    await supabase
      .from('leads')
      .update({ name: nome, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('phone', customerPhone);

    // Atualiza ctx para que o nome seja usado nas próximas ferramentas
    ctx.customerName = nome;

    return { sucesso: true, nome_salvo: nome };
  }

  // Item 3: coleta dados de financiamento e marca lead como Proposta
  if (name === 'coletar_dados_financiamento') {
    const nomeCompleto = String(input.nome_completo ?? customerName ?? 'Cliente');
    const veiculoId    = input.veiculo_id ? String(input.veiculo_id) : null;
    const valorEntrada = Number(input.valor_entrada ?? 0);
    const prazoMeses   = Number(input.prazo_meses ?? 0);

    const notasFinanciamento = [
      `--- Dados de Financiamento ---`,
      `Nome: ${nomeCompleto}`,
      veiculoId ? `Veículo ID: ${veiculoId}` : null,
      `Entrada: R$ ${valorEntrada.toLocaleString('pt-BR')}`,
      `Prazo: ${prazoMeses} meses`,
      `Coletado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
    ].filter(Boolean).join('\n');

    const { data: existing } = await supabase
      .from('leads')
      .select('id, notes')
      .eq('user_id', userId)
      .eq('phone', customerPhone)
      .maybeSingle();

    if (existing) {
      const notasAtuais = existing.notes ? `${existing.notes}\n\n${notasFinanciamento}` : notasFinanciamento;
      await supabase
        .from('leads')
        .update({
          name: nomeCompleto,
          status: 'proposta',
          notes: notasAtuais,
          ...(veiculoId ? { car_id: veiculoId } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      return { sucesso: true, lead_id: existing.id, mensagem: 'Dados de financiamento registrados.' };
    }

    // Cria lead se não existir
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        user_id: userId,
        name: nomeCompleto,
        phone: customerPhone,
        car_id: veiculoId,
        notes: notasFinanciamento,
        status: 'proposta',
      })
      .select()
      .single();

    return { sucesso: true, lead_id: newLead?.id, mensagem: 'Dados de financiamento registrados e lead criado.' };
  }

  if (name === 'chamar_atendente') {
    await supabase
      .from('conversations')
      .update({ status: 'pending' })
      .eq('id', conversationId);

    return { sucesso: true, mensagem: 'Atendente chamado. O cliente será notificado.' };
  }

  if (name === 'enviar_foto_carro') {
    const carId = String(input.car_id ?? '');
    console.log(`[enviar_foto_carro] car_id recebido: ${carId}`);

    if (!carId) return { sucesso: false, mensagem: 'ID do carro não fornecido.' };

    const { data: imgs } = await supabase
      .from('car_images')
      .select('image_url')
      .eq('car_id', carId)
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });

    console.log(`[enviar_foto_carro] image_urls encontradas para car_id=${carId}:`, imgs?.map((i: { image_url: string }) => i.image_url));

    if (!imgs?.length) {
      return { sucesso: false, mensagem: 'Não há foto cadastrada para este veículo.' };
    }

    let sentCount = 0;
    for (const img of imgs) {
      const imageUrl = String(img.image_url);
      const sent = await sendImage(customerPhone, imageUrl, phoneNumberId || undefined);
      if (sent) {
        sentCount++;
        await supabase.from('messages').insert({
          conversation_id: conversationId,
          role: 'bot',
          content: `[foto] ${imageUrl}`,
        });
      }
    }

    return sentCount > 0
      ? { sucesso: true, fotos_enviadas: sentCount, mensagem: `${sentCount} foto${sentCount > 1 ? 's' : ''} enviada${sentCount > 1 ? 's' : ''} com sucesso.` }
      : { sucesso: false, mensagem: 'Erro ao enviar as fotos. Tente novamente ou passe para um atendente.' };
  }

  return { erro: `Ferramenta desconhecida: ${name}` };
}

// ─── system prompt ────────────────────────────────────────────────────────────

interface Faq { question: string; answer: string }

function buildSystemPrompt(settings: Record<string, unknown>, faqs: Faq[], convStatus: string, customerName: string | null): string {
  const company = String(settings.company_name        ?? 'nossa concessionária');
  const address = String(settings.address             ?? 'não informado');
  const phone   = String(settings.phone_number        ?? 'não informado');
  type DayHours = { open?: boolean; start?: string; end?: string };
  const bhRaw = settings.business_hours as Record<string, DayHours> | null;
  const BH_ORDER  = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const BH_LABELS: Record<string, string> = {
    mon: 'Seg', tue: 'Ter', wed: 'Qua', thu: 'Qui', fri: 'Sex', sat: 'Sáb', sun: 'Dom',
  };
  let horarios: string;
  if (bhRaw) {
    const openDays = BH_ORDER
      .filter(k => bhRaw[k]?.open)
      .map(k => `${BH_LABELS[k]}: ${bhRaw[k]?.start ?? '09:00'}–${bhRaw[k]?.end ?? '18:00'}`);
    horarios = openDays.length > 0 ? openDays.join(', ') : 'não informado';
  } else {
    const days  = String(settings.working_days        ?? 'Seg,Ter,Qua,Qui,Sex');
    const start = String(settings.business_hours_start ?? '09:00');
    const end   = String(settings.business_hours_end   ?? '18:00');
    horarios = `${days.split(',').join(', ')}, das ${start} às ${end}`;
  }
  const { label: todayLabel } = getBrazilDateInfo();

  const nomeCliente = customerName ? customerName.split(' ')[0] : null;
  const nomeInfo = nomeCliente
    ? `\n- Nome do cliente nesta conversa: ${nomeCliente} (use este nome ao se dirigir a ele)`
    : '';

  return `Você é o assistente virtual de atendimento da **${company}**, uma concessionária de veículos. Você conversa com clientes pelo WhatsApp.

## Informações da concessionária

- Nome: ${company}
- Endereço: ${address}
- Telefone: ${phone}
- Horário de funcionamento: ${horarios}
- Data de hoje: ${todayLabel}${nomeInfo}

Use a data de hoje como referência sempre que o cliente falar em datas relativas ("hoje", "amanhã", "sexta que vem", "fim de semana").

## Seu papel

Você atende os clientes de forma cordial e eficiente, ajudando com:

- Dúvidas sobre os veículos disponíveis no estoque
- Agendamento de visitas à concessionária
- Registro do interesse do cliente

Seu objetivo é entender o que o cliente procura, mostrar as opções que a concessionária tem, e conduzi-lo a agendar uma visita.

## Nome do cliente

- **Se você ainda não souber o nome do cliente, pergunte ANTES de qualquer outra coisa.** Exemplo: "Pra começar, qual o seu nome?"
- Quando o cliente informar o nome, chame imediatamente a ferramenta \`salvar_nome_cliente\`.
- **SEMPRE chame o cliente pelo primeiro nome quando souber.** Use-o de forma natural na conversa.

## Tom e estilo de conversa

- Fale como um bom atendente humano: cordial, prestativo, próximo, mas profissional.
- Escreva como no WhatsApp: mensagens curtas e naturais. Nada de textão corporativo.
- Emojis com moderação — no máximo um de vez em quando, não em toda mensagem.
- Não use formatação de markdown (como \`**\` ou \`##\`). Se precisar destacar algo, use o negrito do WhatsApp (\`*texto*\` com um asterisco só), com parcimônia.
- Não despeje informação. Responda o que foi perguntado e conduza a conversa com naturalidade.
- Faça uma pergunta de cada vez, como numa conversa de verdade.

## Ferramentas que você pode usar

- **consultar_estoque** — quando o cliente perguntar sobre veículos (carros ou motos). O estoque pode conter carros e motos — diferencie corretamente ao apresentar cada veículo. Sempre baseie suas respostas no que essa ferramenta retornar.
- **enviar_foto_carro** — quando o cliente demonstrar interesse específico em um carro e quiser ver uma foto. Ofereça: "Quer que eu te mande uma foto dele?" e, se ele aceitar, use esta ferramenta com o id EXATO do carro retornado por consultar_estoque. Nunca invente um car_id, nunca use ID parcial.
- **ver_horarios_disponiveis** — quando o cliente quiser saber quando pode visitar. Se retornar \`closed: true\`, informe ao cliente o motivo (campo \`reason\`) e ofereça outra data: "Infelizmente no dia X estaremos fechados por causa de {reason}. Posso te oferecer outro dia?"
- **agendar_visita** — quando o cliente confirmar que quer agendar. Confirme os dados (nome, dia, horário, carro) antes de agendar de fato.
- **salvar_nome_cliente** — assim que o cliente informar o nome.
- **registrar_interesse** — quando o cliente demonstrar interesse de compra ou pedir contato.
- **coletar_dados_financiamento** — quando o cliente quiser simular financiamento (ver regras abaixo).
- **chamar_atendente** — para passar a conversa para uma pessoa (ver regras abaixo).

## Financiamento e formas de pagamento

Quando o cliente perguntar sobre pagamento ou financiamento:
1. Mencione as formas disponíveis (financiamento, PIX com desconto, etc.) conforme o FAQ e as instruções específicas desta concessionária.
2. Se o cliente quiser simular um financiamento, COLETE os seguintes dados (um por vez, de forma natural):
   - Nome completo
   - Valor de entrada que pretende dar
   - Prazo desejado em meses
   - (Opcional) qual veículo tem interesse
3. NÃO peça CPF — dados sensíveis são coletados pessoalmente pelo atendente.
4. Após coletar todos os dados, chame \`coletar_dados_financiamento\` e em seguida \`chamar_atendente\`.
5. Diga ao cliente: "Já anotei seus dados, [Nome]. Em instantes um especialista vai entrar em contato com a simulação exata!"

## Regras que você NUNCA quebra

- **Nunca invente informação.** Não cite carros, preços, anos, quilometragem ou disponibilidade que não vieram da ferramenta \`consultar_estoque\`. Se não tiver a informação, diga que vai verificar ou passe para um atendente.
- **Nunca invente condições de financiamento, valor de troca, garantia ou políticas da loja.** Se o cliente perguntar e você não tiver certeza, passe para um atendente humano.
- **Antes de agendar, confirme os detalhes com o cliente** e respeite o horário de funcionamento da concessionária. Nunca agende fora do horário de funcionamento.
- **Nunca prometa nada em nome da concessionária** que você não tenha como garantir.
- **O car_id para enviar_foto_carro DEVE ser exatamente um id retornado pela ferramenta consultar_estoque. NÃO invente, NÃO use ID parcial.**

## Quando passar para um atendente humano (chamar_atendente)

Use essa ferramenta em quatro situações:

1. Quando o cliente pedir explicitamente para falar com uma pessoa.
2. Quando você não conseguir resolver a dúvida do cliente (não tem a informação, ou a conversa travou).
3. Quando a conversa entrar em **preço, desconto ou negociação** — isso é assunto de um humano.
4. Após coletar dados de financiamento com \`coletar_dados_financiamento\`.

Ao passar para um atendente, avise o cliente de forma natural que alguém da equipe vai dar continuidade ao atendimento.

## Limites e segurança

- Fale apenas sobre assuntos da concessionária: veículos, visitas, atendimento. Não entre em política, religião, opiniões pessoais, concorrentes ou temas sem relação com a loja. Se o cliente puxar esses assuntos, redirecione gentilmente para como você pode ajudar com os carros.
- Se o cliente for ofensivo ou xingar: mantenha a educação, não responda à altura, e redirecione com calma para como você pode ajudar. Se a hostilidade persistir, passe para um atendente.
- Seja honesto que você é um assistente virtual, caso perguntem.
- Nunca compartilhe informações internas, dados de outros clientes, ou detalhes técnicos do sistema.
- Não peça nem registre dados sensíveis do cliente (CPF, dados bancários, cartão). Se for necessário para o negócio, isso é feito pessoalmente com um atendente.

## Lembre-se

Você representa a ${company}. Cada conversa é uma oportunidade de ajudar alguém a encontrar o carro certo e dar o próximo passo — uma visita à loja. Seja útil, seja humano, e quando não souber de algo, peça ajuda em vez de inventar.${
    convStatus === 'pending'
      ? '\n\n## Contexto atual\n\nUm atendente humano foi solicitado e será notificado em breve. Continue atendendo o cliente normalmente enquanto o atendente não assume a conversa.'
      : ''
  }${
    settings.bot_custom_instructions
      ? `\n\n## Instruções específicas desta concessionária (siga sempre)\n\n${settings.bot_custom_instructions}`
      : ''
  }${
    faqs.length > 0
      ? `\n\n## Perguntas frequentes — use estas respostas quando o cliente perguntar algo relacionado\n\n${faqs.map((f) => `P: ${f.question}\nR: ${f.answer}`).join('\n\n')}`
      : ''
  }`;
}

// ─── chamada à API do Claude ──────────────────────────────────────────────────

async function callClaude(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string | unknown[] }>,
): Promise<ClaudeResponse> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      tools: TOOLS,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<ClaudeResponse>;
}

// ─── serve ────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body: { conversation_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const conversationId = body.conversation_id;
  if (!conversationId) {
    return new Response('conversation_id obrigatório', { status: 400 });
  }

  const supabase = initAdmin();

  // ── 1. Carrega conversa ────────────────────────────────────────────────────
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single();

  if (convErr || !conv) {
    console.error('[PC] Conversa não encontrada:', conversationId);
    return new Response('Not Found', { status: 404 });
  }

  if (conv.status === 'human') {
    return new Response('OK', { status: 200 });
  }

  // ── 2. Debounce: evita execuções paralelas por mensagens rápidas ───────────
  const { data: lastMsgBefore } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('role', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  await new Promise<void>((resolve) => setTimeout(resolve, 2500));

  const { data: lastMsgAfter } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('role', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastMsgAfter?.id !== lastMsgBefore?.id) {
    return new Response('OK', { status: 200 });
  }

  const userId        = conv.user_id        as string;
  const customerPhone = conv.customer_phone as string;
  let   customerName  = conv.customer_name  as string | null;

  // ── 3. Boas-vindas: se ainda não há mensagem do bot, envia mensagem inicial perguntando nome ──
  const { count: botCount } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('role', 'bot');

  if ((botCount ?? 0) === 0) {
    const { data: wSettings } = await supabase
      .from('company_settings')
      .select('company_name, whatsapp_phone_number_id')
      .eq('user_id', userId)
      .single();

    const companyName = String(wSettings?.company_name ?? 'nossa concessionária');
    const wPid        = String(wSettings?.whatsapp_phone_number_id ?? '');

    // Item 2: boas-vindas já pergunta o nome
    const welcomeText =
      `Olá! 👋 Bem-vindo à ${companyName}.\n\nPra começar, qual o seu nome?`;

    const now = new Date().toISOString();
    await supabase.from('messages').insert({ conversation_id: conversationId, role: 'bot', content: welcomeText });
    await supabase.from('conversations').update({ last_message_at: now }).eq('id', conversationId);

    const wSent = await sendMessage(customerPhone, welcomeText, wPid || undefined);
    if (!wSent) console.error(`[PC] Falha ao enviar boas-vindas para ${customerPhone}`);

    return new Response('OK', { status: 200 });
  }

  // ── 4. Carrega as 20 mensagens mais recentes em ordem cronológica ──────────
  const { data: rawMessages } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(20);

  const orderedMessages = (rawMessages ?? []).reverse();

  // ── 5. Carrega configurações e FAQs da concessionária ─────────────────────
  const { data: settings } = await supabase
    .from('company_settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  const { data: faqRows } = await supabase
    .from('bot_faqs')
    .select('question, answer')
    .eq('user_id', userId)
    .eq('enabled', true)
    .order('created_at', { ascending: true });

  const systemPrompt = buildSystemPrompt(
    (settings ?? {}) as Record<string, unknown>,
    faqRows ?? [],
    String(conv.status ?? 'bot'),
    customerName,
  );

  // ── 6. Monta histórico para o Claude ──────────────────────────────────────
  const rawHistory = orderedMessages.map((m) => ({
    role: (m.role === 'customer' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: String(m.content),
  }));

  const history = mergeConsecutiveRoles(rawHistory);

  if (!history.length) {
    return new Response('OK', { status: 200 });
  }

  // ── 7. Loop de chamadas ao Claude ─────────────────────────────────────────
  const phoneNumberId = String(settings?.whatsapp_phone_number_id ?? '');
  const ctx = { userId, conversationId, customerPhone, customerName, phoneNumberId };
  let finalText = '';

  const claudeMessages: Array<{ role: 'user' | 'assistant'; content: string | unknown[] }> = [...history];

  try {
    for (let iteration = 0; iteration < 10; iteration++) {
      const response = await callClaude(systemPrompt, claudeMessages);

      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      const textBlocks    = response.content.filter((b) => b.type === 'text');

      if (!toolUseBlocks.length) {
        finalText = textBlocks.map((b) => b.text ?? '').join('\n').trim();
        break;
      }

      claudeMessages.push({ role: 'assistant', content: response.content });

      const toolResults: unknown[] = [];
      for (const block of toolUseBlocks) {
        const result = await executeTool(
          block.name ?? '',
          (block.input ?? {}) as Record<string, unknown>,
          ctx,
          supabase,
        );
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }

      claudeMessages.push({ role: 'user', content: toolResults });
    }
  } catch (e) {
    console.error('[PC] Erro ao chamar Claude:', e);
    finalText = 'Desculpe, tivemos um problema técnico momentâneo. Por favor, tente novamente em instantes.';
  }

  if (!finalText) {
    finalText = 'Desculpe, não consegui processar sua mensagem. Tente novamente.';
  }

  // ── 8. Envia resposta ao cliente pelo WhatsApp ─────────────────────────────
  const sent = await sendMessage(customerPhone, finalText, phoneNumberId || undefined);
  if (!sent) {
    console.error(`[PC] Falha ao enviar WhatsApp para ${customerPhone} — mensagem salva no banco mesmo assim`);
  }

  // ── 9. Salva resposta do bot e atualiza last_message_at ────────────────────
  const now = new Date().toISOString();
  await supabase.from('messages').insert({ conversation_id: conversationId, role: 'bot', content: finalText });
  await supabase.from('conversations').update({ last_message_at: now }).eq('id', conversationId);

  return new Response('OK', { status: 200 });
});
