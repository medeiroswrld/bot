import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { sendMessage, sendImage, sendVideo } from '../_shared/whatsapp.ts';
import { maskPhone, maskName } from '../_shared/maskPII.ts';

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
      'Busca veículos disponíveis no estoque da concessionária — carros e motos. Use sempre que o cliente perguntar sobre veículos, preços, disponibilidade ou características. Aceita múltiplos filtros opcionais combinados — use para buscar SIMILARES quando o modelo exato não existir (ex.: mesma marca, faixa de preço e ano próximos). Sem nenhum filtro, retorna todo o estoque disponível.',
    input_schema: {
      type: 'object',
      properties: {
        marca:        { type: 'string',  description: 'Marca do veículo (ex.: Toyota, Honda, Yamaha)' },
        modelo:       { type: 'string',  description: 'Modelo do veículo (ex.: Corolla, Civic, MT-07)' },
        preco_min:    { type: 'number',  description: 'Preço mínimo em reais' },
        preco_max:    { type: 'number',  description: 'Preço máximo em reais' },
        ano_min:      { type: 'integer', description: 'Ano mínimo de fabricação' },
        ano_max:      { type: 'integer', description: 'Ano máximo de fabricação' },
        tipo:         { type: 'string',  description: 'Tipo de veículo: "carro" ou "moto"' },
        combustivel:  { type: 'string',  description: 'Combustível: flex, gasolina, diesel, elétrico, híbrido' },
        cambio:       { type: 'string',  description: 'Câmbio: manual, automático, CVT' },
        categoria:    { type: 'string',  description: 'Categoria/carroceria desejada: sedan, hatch, SUV, picape (usado como intenção; o filtro principal é marca/preço/ano)' },
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
    name: 'enviar_midia_carro',
    description:
      'Envia a foto de especificações + o vídeo de um veículo pelo WhatsApp (foto primeiro, depois o vídeo). Use quando o cliente perguntar sobre um veículo específico (pedir foto, pedir vídeo, pedir pra ver, ou demonstrar interesse claro). O parâmetro car_id DEVE ser EXATAMENTE o valor do campo "id" retornado pela ferramenta consultar_estoque. Nunca invente um ID, nunca use ID parcial. Se não tiver certeza do id exato, chame consultar_estoque novamente. A ferramenta retorna { success: true, sent: [...] } em caso de sucesso ou { success: false, error: "..." } em caso de falha.',
    input_schema: {
      type: 'object',
      properties: {
        car_id: { type: 'string', description: 'ID exato do carro retornado pelo consultar_estoque' },
      },
      required: ['car_id'],
    },
  },
  {
    name: 'registrar_interesse_veiculo',
    description:
      'Registra que o cliente está procurando um veículo específico que NÃO está disponível no estoque atual (lista de espera). ' +
      'QUANDO USAR: o cliente perguntou por um modelo específico, você buscou em consultar_estoque e não encontrou, e o cliente quer ser avisado quando entrar. ' +
      'QUANDO NÃO USAR: pergunta genérica ("vocês têm carros?") ou cliente só explorando sem dizer o que quer. ' +
      'ANTES de chamar: (1) confirme via consultar_estoque que realmente não tem; (2) pergunte os detalhes (faixa de ano, km máximo, preço máximo); (3) confirme que o cliente quer ser avisado. ' +
      'Depois de chamar, confirme: "Anotado! Assim que entrar um [modelo] nesse perfil, te aviso aqui pelo WhatsApp." ' +
      'Retorna { success: true, action, message } em sucesso ou { success: false, error } em falha.',
    input_schema: {
      type: 'object',
      properties: {
        brand:        { type: 'string',  description: 'Marca do veículo (ex: Honda, Toyota, VW)' },
        model:        { type: 'string',  description: 'Modelo (ex: Civic, Corolla, Onix). OBRIGATÓRIO.' },
        year_min:     { type: 'integer', description: 'Ano mínimo aceito' },
        year_max:     { type: 'integer', description: 'Ano máximo aceito' },
        km_max:       { type: 'integer', description: 'KM máximo aceito (ex: 90000 para 90 mil km)' },
        price_min:    { type: 'number',  description: 'Preço mínimo aceito em R$' },
        price_max:    { type: 'number',  description: 'Preço máximo aceito em R$' },
        vehicle_type: { type: 'string',  description: 'Tipo: carro, moto, caminhonete' },
        fuel:         { type: 'string',  description: 'Combustível: flex, gasolina, diesel' },
        transmission: { type: 'string',  description: 'Câmbio: manual ou automatico' },
        color:        { type: 'string',  description: 'Cor desejada' },
        notes:        { type: 'string',  description: 'Observações adicionais do cliente' },
      },
      required: ['model'],
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

    if (input.marca)       query = query.ilike('brand', `%${input.marca}%`);
    if (input.modelo)      query = query.ilike('model', `%${input.modelo}%`);
    if (input.preco_min)   query = query.gte('price', Number(input.preco_min));
    if (input.preco_max)   query = query.lte('price', Number(input.preco_max));
    if (input.ano_min)     query = query.gte('year',  Number(input.ano_min));
    if (input.ano_max)     query = query.lte('year',  Number(input.ano_max));
    if (input.tipo)        query = query.eq('vehicle_type', String(input.tipo));
    if (input.combustivel) query = query.ilike('fuel', `%${input.combustivel}%`);
    if (input.cambio)      query = query.ilike('transmission', `%${input.cambio}%`);
    // 'categoria' (sedan/hatch/SUV/picape) não tem coluna no schema — aceito como intenção,
    // o filtro real é por marca/preço/ano. Ignorado na query para não quebrar.

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
      .select('business_hours, appointment_duration, appointment_interval, max_appointments_per_slot, working_days, business_hours_start, business_hours_end')
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
        if (!bh) {
          // business_hours não configurado no novo formato — usa campos legados ou padrões
          const LEGACY_MAP: Record<string, string> = {
            sun: 'Dom', mon: 'Seg', tue: 'Ter', wed: 'Qua', thu: 'Qui', fri: 'Sex', sat: 'Sáb',
          };
          const workingDays = String(settings?.working_days ?? 'Seg,Ter,Qua,Qui,Sex')
            .split(',').map((s: string) => s.trim());
          const legacyLabel = LEGACY_MAP[dayKey] ?? '';
          console.log('[AGENDA] business_hours null — fallback legacy, dia:', legacyLabel, 'workingDays:', workingDays);
          if (!workingDays.includes(legacyLabel)) {
            return { disponivel: false, mensagem: `A concessionária não funciona às ${dayLabel}. Tente outro dia.` };
          }
          slotStart = String(settings?.business_hours_start ?? '09:00');
          slotEnd   = String(settings?.business_hours_end   ?? '18:00');
        } else {
          console.log('[AGENDA] Dia fechado no business_hours:', dayKey, dayHours);
          return { disponivel: false, mensagem: `A concessionária não funciona às ${dayLabel}. Tente outro dia.` };
        }
      } else {
        slotStart = dayHours.start ?? '09:00';
        slotEnd   = dayHours.end   ?? '18:00';
      }
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
    // Slot disponível enquanto count < max_appointments_per_slot
    const free = slots.filter((s) => (slotCount.get(s) ?? 0) < maxPerSlot);
    console.log('[slot] ver_horarios:', { data: dateStr, maxPerSlot, ocupacao: Object.fromEntries(slotCount), livres: free.length });

    return { data: dateStr, dia_semana: dayLabel, horarios_livres: free, total_disponivel: free.length };
  }

  if (name === 'agendar_visita') {
    const dateStr     = String(input.data    ?? '');
    const horario     = String(input.horario ?? '');
    const nomeCliente = String(input.nome_cliente ?? customerName ?? 'Cliente');
    const carId       = input.car_id ? String(input.car_id) : null;

    console.log('[agendar_visita] params:', { dateStr, horario, nomeCliente: maskName(nomeCliente), carId, userId, customerPhone: maskPhone(customerPhone) });

    if (!dateStr || !horario) {
      console.error('[agendar_visita] data ou horario ausente:', { dateStr, horario });
      return { sucesso: false, error: 'Data ou horário não informado.' };
    }

    // user_id é SEMPRE o dono do bot (vem de conv.user_id), nunca o cliente
    const { data: settings, error: settingsErr } = await supabase
      .from('company_settings')
      .select('booking_mode, max_appointments_per_slot')
      .eq('user_id', userId)
      .single();

    if (settingsErr) {
      console.error('[agendar_visita] erro ao ler company_settings:', JSON.stringify(settingsErr));
      return { sucesso: false, error: 'Não consegui acessar as configurações da agenda. Vou chamar um atendente.' };
    }

    const maxPerSlot = Number(settings?.max_appointments_per_slot ?? 1);

    // BUG 4: respeita max_appointments_per_slot — só bloqueia se já atingiu o máximo
    const { data: existingAtSlot, error: countErr } = await supabase
      .from('appointments')
      .select('id')
      .eq('user_id', userId)
      .eq('appointment_date', dateStr)
      .eq('appointment_time', horario)
      .neq('status', 'cancelled');

    if (countErr) {
      console.error('[agendar_visita] erro ao contar slot:', JSON.stringify(countErr));
      return { sucesso: false, error: 'Não consegui verificar a disponibilidade. Vou chamar um atendente.' };
    }

    const slotCount = existingAtSlot?.length ?? 0;
    console.log('[slot]', { hora: horario, count: slotCount, max: maxPerSlot });

    if (slotCount >= maxPerSlot) {
      console.log('[agendar_visita] slot lotado:', horario, slotCount, '>=', maxPerSlot);
      return { sucesso: false, error: 'Este horário já está lotado. Escolha outro horário.' };
    }

    const appointmentStatus = settings?.booking_mode === 'confirm' ? 'scheduled' : 'confirmed';

    // Colunas: appointment_date = DATE ('YYYY-MM-DD'), appointment_time = TIME ('HH:MM')
    const insertData = {
      user_id: userId,
      customer_name: nomeCliente,
      customer_phone: customerPhone,
      appointment_date: dateStr,
      appointment_time: horario,
      car_id: carId,
      status: appointmentStatus,
    };
    console.log('[agendar_visita] inserindo:', JSON.stringify(insertData));

    const { data: appt, error } = await supabase
      .from('appointments')
      .insert(insertData)
      .select()
      .single();

    console.log('[agendar_visita] resultado:', JSON.stringify(appt ?? null), 'erro:', error ? JSON.stringify(error) : 'nenhum');

    // BUG 1: se o INSERT falhar, retorna erro REAL ao Claude — nunca finge sucesso
    if (error || !appt) {
      console.error('[agendar_visita] INSERT FALHOU:', JSON.stringify(error));
      return { sucesso: false, error: `Falha ao salvar o agendamento no banco: ${error?.message ?? 'desconhecido'}` };
    }

    console.log('[agendar_visita] Agendamento criado:', appt.id, appt.appointment_date, appt.appointment_time);

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

  if (name === 'enviar_midia_carro') {
    const carId = String(input.car_id ?? '');
    console.log('[enviar_midia_carro] car_id:', carId, 'user_id:', userId);

    if (!carId) return { success: false, error: 'ID do carro não fornecido' };

    // 1. Busca o carro (só do dono do bot)
    const { data: car, error: carErr } = await supabase
      .from('cars')
      .select('id, brand, model, specs_image_url, video_url, user_id')
      .eq('id', carId)
      .eq('user_id', userId)
      .single();

    console.log('[enviar_midia_carro] car:', JSON.stringify(car ?? null), 'error:', carErr ? JSON.stringify(carErr) : 'nenhum');

    if (carErr || !car) {
      return { success: false, error: 'Veículo não encontrado' };
    }

    const carName = [car.brand, car.model].filter(Boolean).join(' ') || 'veículo';
    let specsImageUrl: string | null = car.specs_image_url;
    const videoUrl: string | null = car.video_url;

    // 2. Fallback: sem specs_image_url, usa a primeira foto de car_images
    if (!specsImageUrl) {
      const { data: firstImage } = await supabase
        .from('car_images')
        .select('image_url')
        .eq('car_id', carId)
        .eq('user_id', userId)
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstImage?.image_url) specsImageUrl = String(firstImage.image_url);
    }

    // 3. Sem nada cadastrado
    if (!specsImageUrl && !videoUrl) {
      return { success: false, error: 'Este veículo ainda não tem fotos ou vídeo cadastrados' };
    }

    const sentItems: string[] = [];
    const pid = phoneNumberId || undefined;

    // 4. Foto primeiro
    if (specsImageUrl) {
      try {
        const ok = await sendImage(customerPhone, specsImageUrl, pid);
        if (ok) {
          sentItems.push('foto');
          await supabase.from('messages').insert({
            conversation_id: conversationId, role: 'bot', content: `[foto] ${specsImageUrl}`,
          });
          // Delay entre foto e vídeo para chegarem em ordem
          await new Promise((r) => setTimeout(r, 1500));
        }
      } catch (e) {
        console.error('[enviar_midia_carro] erro foto:', e);
      }
    }

    // 5. Vídeo depois
    if (videoUrl) {
      try {
        const ok = await sendVideo(customerPhone, videoUrl, pid);
        if (ok) {
          sentItems.push('vídeo');
          await supabase.from('messages').insert({
            conversation_id: conversationId, role: 'bot', content: `[vídeo] ${videoUrl}`,
          });
        }
      } catch (e) {
        console.error('[enviar_midia_carro] erro vídeo:', e);
      }
    }

    if (sentItems.length === 0) {
      return { success: false, error: 'Falha ao enviar as mídias' };
    }

    return {
      success: true,
      sent: sentItems,
      message: `Enviei ${sentItems.join(' e ')} do ${carName}.`,
    };
  }

  if (name === 'registrar_interesse_veiculo') {
    const model = String(input.model ?? '').trim();
    console.log('[registrar_interesse_veiculo] params:', JSON.stringify(input));
    console.log('[registrar_interesse_veiculo] ctx:', { userId, customerPhone: maskPhone(customerPhone), conversationId });

    if (!model) return { success: false, error: 'Modelo não informado.' };

    // Busca o lead do cliente (por telefone) para vincular e pegar o nome
    const { data: lead } = await supabase
      .from('leads')
      .select('id, name')
      .eq('user_id', userId)
      .eq('phone', customerPhone)
      .maybeSingle();

    const leadId = lead?.id ?? null;
    const nomeCliente = lead?.name ?? customerName ?? null;

    const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));
    const str = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));

    const fields = {
      brand:        str(input.brand),
      model,
      year_min:     num(input.year_min),
      year_max:     num(input.year_max),
      km_max:       num(input.km_max),
      price_min:    num(input.price_min),
      price_max:    num(input.price_max),
      vehicle_type: str(input.vehicle_type),
      fuel:         str(input.fuel),
      transmission: str(input.transmission),
      color:        str(input.color),
      notes:        str(input.notes),
      customer_name: nomeCliente,
    };

    // Anti-duplicação: já existe interesse ativo desse cliente para esse modelo?
    const { data: existing } = await supabase
      .from('vehicle_interests')
      .select('id')
      .eq('user_id', userId)
      .eq('customer_phone', customerPhone)
      .ilike('model', model)
      .eq('status', 'active')
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('vehicle_interests')
        .update(fields)
        .eq('id', existing.id);
      if (error) {
        console.error('[registrar_interesse_veiculo] erro update:', JSON.stringify(error));
        return { success: false, error: 'Não consegui salvar seu interesse, vou chamar um atendente.' };
      }
      console.log('[registrar_interesse_veiculo] atualizado:', existing.id);
      return { success: true, action: 'updated', message: `Interesse atualizado para ${model}.` };
    }

    const { data: created, error } = await supabase
      .from('vehicle_interests')
      .insert({
        user_id: userId,
        lead_id: leadId,
        conversation_id: conversationId,
        customer_phone: customerPhone,
        status: 'active',
        ...fields,
      })
      .select('id')
      .single();

    console.log('[registrar_interesse_veiculo] resultado:', JSON.stringify(created ?? null), 'erro:', error ? JSON.stringify(error) : 'nenhum');

    if (error || !created) {
      console.error('[registrar_interesse_veiculo] erro insert:', JSON.stringify(error));
      return { success: false, error: 'Falha ao salvar interesse no banco' };
    }

    const anoInfo = fields.year_min ? ` ${fields.year_min}-${fields.year_max ?? fields.year_min}` : '';
    return { success: true, action: 'created', message: `Interesse registrado: ${model}${anoInfo}.` };
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
- **enviar_midia_carro** — envia a foto de especificações + o vídeo do veículo para o cliente. Use sempre que o cliente perguntar sobre um veículo específico (pedir foto, pedir pra ver, pedir vídeo, ou demonstrar interesse claro). Ofereça: "Quer que eu te mande a foto e o vídeo dele?" e, se ele aceitar, use esta ferramenta com o id EXATO do carro retornado por consultar_estoque. Nunca invente um car_id, nunca use ID parcial. A ferramenta retorna \`success: true\` com a lista \`sent\` em sucesso, ou \`success: false\` com \`error\` em falha. **Se retornar \`success: false\`, NUNCA diga ao cliente que enviou as mídias — avise que houve um problema técnico e ofereça chamar um atendente.**
- **ver_horarios_disponiveis** — quando o cliente quiser saber quando pode visitar. Se retornar \`closed: true\`, informe ao cliente o motivo (campo \`reason\`) e ofereça outra data: "Infelizmente no dia X estaremos fechados por causa de {reason}. Posso te oferecer outro dia?"
- **agendar_visita** — quando o cliente confirmar que quer agendar. Confirme os dados (nome, dia, horário, carro) antes de agendar de fato. **IMPORTANTE: só diga que a visita foi agendada se a ferramenta retornar \`sucesso: true\`. Se retornar \`sucesso: false\`, NUNCA diga ao cliente que o agendamento foi feito — avise que houve um problema e chame um atendente (chamar_atendente).** Sempre verifique a quantidade máxima de agendamentos por horário antes de oferecer alternativa: use ver_horarios_disponiveis e ofereça apenas horários da lista \`horarios_livres\`.
- **salvar_nome_cliente** — assim que o cliente informar o nome.
- **registrar_interesse** — quando o cliente demonstrar interesse de compra ou pedir contato.
- **registrar_interesse_veiculo** — quando o cliente procura um modelo específico que NÃO está no estoque e quer ser avisado quando entrar (lista de espera). Veja a seção "Quando não tiver o veículo no estoque".
- **coletar_dados_financiamento** — quando o cliente quiser simular financiamento (ver regras abaixo).
- **chamar_atendente** — para passar a conversa para uma pessoa (ver regras abaixo).

## Quando o cliente pede um carro que NÃO tem no estoque

Sua missão é DUPLA — você registra o interesse E tenta converter a venda na hora. NÃO deixe o cliente sair sem mostrar alternativas.

PROCESSO OBRIGATÓRIO:

1. Após confirmar via consultar_estoque que o modelo exato não existe, IMEDIATAMENTE chame registrar_interesse_veiculo com os dados que você já tem (mesmo que seja só o modelo — você completa depois). NÃO pergunte muitos detalhes antes de salvar.

2. Na MESMA resposta, ofereça alternativas. Use consultar_estoque de novo, dessa vez buscando carros SIMILARES:
   - Mesma categoria (se o cliente quer sedan, busque sedans)
   - Mesma marca (se pediu Honda, busque outros Honda)
   - Faixa de preço próxima (use preco_min/preco_max)
   - Faixa de ano próxima (use ano_min/ano_max)

3. Apresente no máximo 2-3 opções, descrevendo brevemente:
   "Não tenho exatamente esse no momento, mas dá uma olhada nessas opções parecidas que temos:
   • Toyota Corolla 2011 – R$ 58mil, 78mil km
   • Honda Civic 2012 – R$ 65mil, 90mil km
   Qual te interessa mais? Posso te mandar foto e vídeo."

4. Se o cliente DEMONSTRAR INTERESSE em alguma alternativa:
   → Chame enviar_midia_carro com o car_id correto
   → Em seguida, chame chamar_atendente
   → Diga: "Massa! Mandei aqui as fotos e o vídeo. Já tô chamando um atendente pra fechar com você."

5. Se o cliente RECUSAR as alternativas (primeira vez):
   Tente UMA VEZ mais com um ângulo diferente. Ex.: "Entendi, você prefere o modelo específico. Mas esse Corolla 2011 tá com um preço bem em conta e é da mesma família — vale espiar as fotos antes de descartar?"

6. Se o cliente RECUSAR de novo (segunda vez):
   Aceite e encerre com classe: "Tudo certo! Já registrei seu interesse aqui. Assim que entrar um [modelo] no perfil que você quer, te aviso na hora pelo WhatsApp. Pode contar comigo."

7. Se NÃO HOUVER alternativas no estoque (estoque enxuto ou nada similar):
   Não invente. Diga a verdade e foque na lista de espera: "No momento tô com o estoque enxuto desse perfil. Mas já anotei seu interesse aqui — assim que entrar algo, você é o primeiro a saber."

REGRA DE OURO: nunca seja insistente a ponto de irritar. No máximo 2 tentativas de oferecer alternativa. Depois disso, respeite o "não" do cliente e encerre com elegância.

REGRA DE LIMPEZA: depois de mostrar alternativas e o cliente aceitar uma ou recusar todas, NÃO repita a oferta nas próximas mensagens. A conversa segue normal (se ele perguntar horário, responda só o horário).

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
- **Nunca confirme um agendamento sem que a ferramenta agendar_visita retorne \`sucesso: true\`.** Se a ferramenta retornar \`sucesso: false\` ou um campo \`error\`, informe ao cliente que houve um problema técnico ao registrar e que um atendente vai finalizar — então chame chamar_atendente. Jamais diga "marquei sua visita" baseado só na sua intenção.
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
  attempt = 0,
): Promise<ClaudeResponse> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  // Backoff exponencial: 2s, 5s, 10s (3 tentativas extras)
  const BACKOFF_MS = [2000, 5000, 10000];
  const MAX_RETRIES = BACKOFF_MS.length;

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
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
  } catch (netErr) {
    // Erro de rede → retry com backoff
    if (attempt < MAX_RETRIES) {
      const delay = BACKOFF_MS[attempt];
      console.warn(`[CLAUDE] erro de rede — retry ${attempt + 1}/${MAX_RETRIES} em ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      return callClaude(systemPrompt, messages, attempt + 1);
    }
    throw netErr;
  }

  if (!res.ok) {
    const body = await res.text();
    // Erros transitórios (rate limit 429, sobrecarga 529, server 5xx) → retry com backoff
    const retriable = [408, 409, 429, 500, 502, 503, 504, 529].includes(res.status);
    if (retriable && attempt < MAX_RETRIES) {
      const delay = BACKOFF_MS[attempt]; // 2s, 5s, 10s
      console.warn(`[CLAUDE] ${res.status} — retry ${attempt + 1}/${MAX_RETRIES} em ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      return callClaude(systemPrompt, messages, attempt + 1);
    }
    console.error(`[CLAUDE_FATAL] ${res.status} após ${attempt} retries: ${body.slice(0, 300)}`);
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

  const userId        = conv.user_id        as string;
  const customerPhone = conv.customer_phone as string;
  let   customerName  = conv.customer_name  as string | null;

  // ── 2. Verifica se é a primeira mensagem (boas-vindas) — sem debounce ─────
  const { count: botCount } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('role', 'bot');

  const isFirstMessage = (botCount ?? 0) === 0;

  // ── 3. Debounce 3s: aguarda e aborta se cliente enviou nova mensagem ───────
  //    Pulado para boas-vindas (primeira mensagem → resposta imediata sem delay)
  if (!isFirstMessage) {
    const { data: lastMsgBefore } = await supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversationId)
      .eq('role', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    await new Promise<void>((resolve) => setTimeout(resolve, 4000));

    const { data: lastMsgAfter } = await supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversationId)
      .eq('role', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastMsgAfter?.created_at !== lastMsgBefore?.created_at) {
      console.log('[debounce] mensagem mais nova detectada, abortando');
      return new Response('OK', { status: 200 });
    }
  }

  // ── 3.5. Lock atômico: garante que só UMA invocação processa este lote ────
  //    Resolve a corrida quando o cliente manda várias mensagens quase juntas.
  const { data: latestCustomerMsg } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('role', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const batchKey = latestCustomerMsg?.id ?? `welcome-${conversationId}`;

  const { data: claimed, error: claimErr } = await supabase
    .from('conversations')
    .update({ last_handled_msg_id: batchKey })
    .eq('id', conversationId)
    .or(`last_handled_msg_id.is.null,last_handled_msg_id.neq.${batchKey}`)
    .select('id')
    .maybeSingle();

  if (claimErr) {
    // A coluna last_handled_msg_id pode ainda não existir — não bloqueia o bot,
    // apenas registra. A dedupe passa a valer assim que a coluna for criada.
    console.warn('[PC] Claim ignorado (coluna last_handled_msg_id existe?):', claimErr.message);
  } else if (!claimed) {
    console.log('[PC] Lote já assumido por outra invocação — abortando.', batchKey);
    return new Response('OK', { status: 200 });
  }

  // ── 4. Boas-vindas: primeira mensagem da conversa ─────────────────────────
  if (isFirstMessage) {
    const { data: wSettings } = await supabase
      .from('company_settings')
      .select('company_name, whatsapp_phone_number_id')
      .eq('user_id', userId)
      .single();

    const companyName = String(wSettings?.company_name ?? 'nossa concessionária');
    const wPid        = String(wSettings?.whatsapp_phone_number_id ?? '');

    const welcomeText =
      `Olá! 👋 Bem-vindo à ${companyName}.\n\nPra começar, qual o seu nome?`;

    const now = new Date().toISOString();
    await supabase.from('messages').insert({ conversation_id: conversationId, role: 'bot', content: welcomeText });
    await supabase.from('conversations').update({ last_message_at: now }).eq('id', conversationId);

    const wSent = await sendMessage(customerPhone, welcomeText, wPid || undefined);
    if (!wSent) console.error(`[PC] Falha ao enviar boas-vindas para ${maskPhone(customerPhone)}`);

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

      console.log('[CLAUDE_RESPONSE]', JSON.stringify({
        iteration,
        stop_reason: response.stop_reason,
        content_types: response.content.map((c) => c.type),
        content_preview: response.content.slice(0, 2),
      }));

      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      const textBlocks    = response.content.filter((b) => b.type === 'text');

      if (!toolUseBlocks.length) {
        finalText = textBlocks.map((b) => b.text ?? '').join('\n').trim();
        if (!finalText) {
          console.error('[NO_TEXT_FROM_CLAUDE]', JSON.stringify(response.content));
        }
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
    const err = e instanceof Error ? e : new Error(String(e));
    console.error('[FALLBACK]', err.message, err.stack);
    console.error('[PC] Erro ao chamar Claude (após retries):', e);

    // Falha persistente após os retries. Avisa o cliente de forma amigável
    // PRIMEIRO e só DEPOIS faz o handoff — garantindo que a mensagem chegue
    // mesmo se a atualização de status falhar.
    const fallbackMsg = 'Tive uma instabilidade aqui, mas já tô avisando um atendente pra continuar te ajudar. Em instantes alguém da equipe vai te responder.';

    try {
      const fbSent = await sendMessage(customerPhone, fallbackMsg, phoneNumberId || undefined);
      await supabase.from('messages').insert({ conversation_id: conversationId, role: 'bot', content: fallbackMsg });
      await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId);
      if (!fbSent) console.error(`[PC] Falha ao enviar mensagem de fallback para ${maskPhone(customerPhone)} (salva no banco mesmo assim)`);
    } catch (sendErr) {
      console.error('[PC] Erro ao enviar mensagem de fallback:', sendErr);
    }

    // Handoff em bloco separado: se falhar, o cliente já recebeu o aviso acima.
    try {
      await supabase.from('conversations').update({ status: 'pending' }).eq('id', conversationId);
      console.error('[PC] Conversa marcada como pending (handoff) após falha do Claude.');
    } catch (handoffErr) {
      console.error('[PC] Falha ao fazer handoff (status pending):', handoffErr);
    }

    return new Response('OK', { status: 200 });
  }

  // Resposta vazia sem erro (ex.: Claude só fez tool calls e não gerou texto):
  // aborta em silêncio, sem poluir o chat com mensagem de erro.
  if (!finalText.trim()) {
    console.error('[PC] Resposta vazia do Claude — abortando sem enviar nada ao cliente.');
    return new Response('OK', { status: 200 });
  }

  // ── 8. Envia resposta ao cliente pelo WhatsApp ─────────────────────────────
  const sent = await sendMessage(customerPhone, finalText, phoneNumberId || undefined);
  if (!sent) {
    console.error(`[PC] Falha ao enviar WhatsApp para ${maskPhone(customerPhone)} — mensagem salva no banco mesmo assim`);
  }

  // ── 9. Salva resposta do bot e atualiza last_message_at ────────────────────
  const now = new Date().toISOString();
  await supabase.from('messages').insert({ conversation_id: conversationId, role: 'bot', content: finalText });
  await supabase.from('conversations').update({ last_message_at: now }).eq('id', conversationId);

  return new Response('OK', { status: 200 });
});
