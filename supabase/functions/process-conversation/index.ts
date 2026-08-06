import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { sendMessage, sendImage, sendVideo, resolveWhatsAppToken } from '../_shared/whatsapp.ts';
import { maskName } from '../_shared/maskPII.ts';
import { withRequest, type Logger } from '../_shared/logger.ts';

// deploy: vendas ETAPA A (consultar_estoque cruza visitas) + fixes agendamento (8380dc1)

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
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
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

  // Rótulo legível SÓ com a data: "sexta-feira, 23/05/2026".
  // A hora NÃO entra aqui de propósito: o label vai no system prompt (cacheado) e
  // um timestamp que muda a cada minuto quebraria o prompt caching (invalidador
  // silencioso). A validação de horário passado/fechado é server-side no
  // computeFreeSlots — o bot não perde nada.
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

// Cálculo de financiamento — Tabela Price. Pura, sem IA.
// parcela = VF * (i*(1+i)^n) / ((1+i)^n - 1); i = taxa mensal decimal; n = parcelas.
function calcParcelaPrice(valorFinanciado: number, taxaMensalPct: number, n: number): number {
  if (valorFinanciado <= 0 || n <= 0) return 0;
  const i = (Number(taxaMensalPct) || 0) / 100;
  if (i <= 0) return valorFinanciado / n; // sem juros
  const fator = Math.pow(1 + i, n);
  return valorFinanciado * (i * fator) / (fator - 1);
}

const TOOLS = [
  {
    name: 'consultar_estoque',
    description:
      'Busca veículos disponíveis no estoque da concessionária — carros e motos. Use sempre que o cliente perguntar sobre veículos, preços, disponibilidade ou características. Aceita múltiplos filtros opcionais combinados — use para buscar SIMILARES quando o modelo exato não existir (ex.: mesma marca, faixa de preço e ano próximos). Sem nenhum filtro, retorna todo o estoque disponível. DOIS FORMATOS DE RESPOSTA: se vier "modo":"resumo", o estoque é grande demais pra listar — siga o campo "instrucao": diga o total, comente a variedade e faça UMA pergunta pra estreitar (faixa de preço, marca ou tipo), depois consulte de novo com o filtro. Caso contrário vem a lista em "veiculos". O campo "observacoes" traz o que a LOJA escreveu sobre aquele veículo específico (opcionais, estado, único dono, detalhes de negociação). Quando vier preenchido, é a informação mais valiosa que você tem sobre o carro: use ao apresentá-lo e ao responder perguntas sobre ele. Nunca ignore. ATENÇÃO ao conflito: se as observações contradisserem um campo estruturado (ex.: campo diz câmbio automático e as observações dizem manual), NÃO afirme nenhum dos dois nem os apresente juntos — cite o resto normalmente e diga que confirma esse detalhe específico com a loja.',
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
      'Retorna os horários de visita disponíveis para uma data específica. Use SEMPRE antes de citar dia ou horário ao cliente. Se retornar closed: true, informe o motivo (campo reason) e ofereça outra data.',
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
      'Agenda uma visita na concessionária. Chame assim que tiver dia + horário LIVRE (em horarios_livres) + nome do cliente — NÃO peça confirmação extra nem escale pro gerente quando o horário está livre. SEMPRE informe o car_id do veículo que motivou a visita (do consultar_estoque) — é essencial pra contar quantas visitas cada carro tem.',
    input_schema: {
      type: 'object',
      properties: {
        nome_cliente: { type: 'string', description: 'Nome do cliente' },
        data:         { type: 'string', description: 'Data no formato YYYY-MM-DD' },
        horario:      { type: 'string', description: 'Horário no formato HH:MM' },
        car_id:       { type: 'string', description: 'ID do veículo de interesse (do consultar_estoque). SEMPRE informe quando a visita for pra ver um carro específico.' },
      },
      required: ['nome_cliente', 'data', 'horario'],
    },
  },
  {
    name: 'request_schedule_check',
    description:
      'Use SÓ quando o cliente pedir um horário que você confirmou (via ver_horarios_disponiveis) estar OCUPADO — não aparece em horarios_livres. Horário LIVRE = agendar_visita, NUNCA esta. Depois de chamar, diga só "deixa eu verificar com meu superior, te respondo em alguns minutos" (nunca fale em atendente/sistema); a resposta chega ao cliente depois, automaticamente.',
    input_schema: {
      type: 'object',
      properties: {
        requested_datetime: { type: 'string', description: 'Data e hora que o cliente pediu, formato YYYY-MM-DDTHH:MM (ex: 2026-06-25T14:00)' },
        customer_message:   { type: 'string', description: 'Resumo do que o cliente pediu / contexto nas palavras dele' },
      },
      required: ['requested_datetime'],
    },
  },
  {
    name: 'cancelar_visita',
    description:
      'Cancela um agendamento existente do cliente. Use quando o cliente claramente quiser desmarcar/cancelar uma visita já agendada (ex: respondendo a lembrete dizendo que não vai poder ir).',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Motivo do cancelamento conforme dito pelo cliente. Ex: "imprevisto no trabalho"' },
      },
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
    name: 'simular_financiamento',
    description:
      'Calcula uma ESTIMATIVA de parcela de financiamento (Tabela Price) com a config da loja. Use quando o cliente pedir pra simular o financiamento de um carro específico. Apresente SEMPRE como estimativa, com o disclaimer retornado, e convide pra confirmar na loja. Nunca afirme que a parcela é o valor final.',
    input_schema: {
      type: 'object',
      properties: {
        car_price:      { type: 'number',  description: 'Preço do carro escolhido (do consultar_estoque)' },
        down_payment:   { type: 'number',  description: 'Entrada em dinheiro informada pelo cliente (default 0)' },
        trade_in_value: { type: 'number',  description: 'Valor estimado da troca, se houver (default 0)' },
        installments:   { type: 'integer', description: 'Prazo em meses; se não informado, usa o máximo da loja' },
      },
      required: ['car_price'],
    },
  },
  {
    name: 'chamar_atendente',
    description:
      'Handoff interno e SILENCIOSO pra equipe humana (o cliente nunca percebe transferência nem ouve "atendente"). Use quando: (1) o cliente pede pra falar com uma pessoa; (2) a conversa entra em preço/desconto/negociação; (3) você não consegue resolver a dúvida; (4) após coletar_dados_financiamento.',
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
      'Envia as FOTOS do veículo (até 5, de uma vez) e depois o vídeo. Uma única chamada já manda tudo que existe cadastrado — NÃO chame de novo pedindo "mais fotos", porque vai reenviar exatamente as mesmas. Se o cliente pedir mais ângulos depois disso, diga que essas são as que você tem e convide pra ver o carro na loja. Use quando o cliente pedir foto/vídeo, pedir pra ver, ou demonstrar interesse claro num carro. SEQUÊNCIA OBRIGATÓRIA: chame consultar_estoque ANTES, nesta mesma resposta, e use o id retornado AGORA — ids de turnos anteriores NÃO existem mais no seu contexto; usar id "de memória" é inventar. Envie SEMPRE marca e modelo junto (plano B se o id falhar). Se não estiver claro de QUAL carro o cliente quer a foto, pergunte antes de enviar. Antes de OFERECER mídia, confira no consultar_estoque se o campo "fotos" é maior que 0 — nunca prometa foto que não existe. RETORNOS: success true = enviada, diga que mandou. success false com sem_midia true = o carro não tem mídia cadastrada e isso NÃO é erro: nunca fale em "problema" nem prometa enviar depois, passe os detalhes por texto e siga qualificando. success false com error = falha técnica real: avise que teve um probleminha e acione chamar_atendente nos bastidores.',
    input_schema: {
      type: 'object',
      properties: {
        car_id: { type: 'string', description: 'ID exato do carro retornado pelo consultar_estoque DESTA resposta' },
        marca:  { type: 'string', description: 'Marca do carro (ex.: Toyota) — usada como fallback se o car_id falhar' },
        modelo: { type: 'string', description: 'Modelo do carro (ex.: Corolla) — usado como fallback se o car_id falhar' },
      },
      required: ['car_id'],
    },
  },
  {
    name: 'registrar_interesse_veiculo',
    description:
      'Registra na lista de espera um MODELO que o cliente procura e NÃO está no estoque atual. Use após confirmar via consultar_estoque que não tem E o cliente querer ser avisado quando entrar. NÃO use pra pergunta genérica ("vocês têm carros?") ou quem só explora. Antes: pergunte os detalhes (faixa de ano, km máx, preço máx). Depois de registrar, NÃO dispense o cliente — puxe de volta pra venda com alternativas reais do estoque. model é obrigatório; os demais campos, opcionais.',
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
  {
    name: 'save_lead_qualification',
    description:
      'Use SEMPRE que descobrir naturalmente uma informação relevante do cliente durante a conversa: estado civil/filhos (family), profissão/ocupação (occupation), uso do carro/hobbies (recreation), ou capacidade financeira/forma de pagamento (financial). Não precisa ter as 4 ao mesmo tempo — vai salvando aos poucos. NÃO faça perguntas só pra preencher; só salve quando a informação surgir naturalmente.',
    input_schema: {
      type: 'object',
      properties: {
        family:     { type: 'string', description: 'Estado civil, filhos, situação familiar. Ex: "casado, 2 filhos pequenos"' },
        occupation: { type: 'string', description: 'Profissão, área de atuação. Ex: "engenheiro civil"' },
        recreation: { type: 'string', description: 'Uso do carro, hobbies. Ex: "vai usar pra passeio em família aos fins de semana"' },
        financial:  { type: 'string', description: 'Forma de pagamento, orçamento. Ex: "à vista até 80 mil" ou "financiamento, tem 20 mil de entrada"' },
      },
    },
  },
  {
    name: 'save_trade_in_evaluation',
    description:
      'Use quando coletar informações sobre o carro que o cliente quer dar como entrada/troca. Vai salvando aos poucos conforme descobrir cada info — não precisa ter todas de uma vez. NÃO faça interrogatório.',
    input_schema: {
      type: 'object',
      properties: {
        model:              { type: 'string', description: 'Marca e modelo. Ex: "Toyota Corolla XEi"' },
        year:               { type: 'string', description: 'Ano. Ex: "2018"' },
        km:                 { type: 'string', description: 'Quilometragem. Ex: "65.000"' },
        ownership_time:     { type: 'string', description: 'Há quanto tempo é dono. Ex: "3 anos"' },
        owner_rating:       { type: 'string', description: 'Nota que o dono daria pro carro (0-10). Ex: "8"' },
        payment_preference: { type: 'string', description: 'Forma desejada: troca pura, troca com diferença à vista, troca com diferença financiada. Ex: "troca + diferença financiada"' },
        difference_payment: { type: 'string', description: 'Se for troca com diferença: como vai pagar a diferença. Ex: "10mil à vista + financiar o resto"' },
        extra_info:         { type: 'string', description: 'Outras informações que o cliente compartilhou sobre o carro (cor, condição, modificações, perguntas extras configuradas pela loja). Texto livre.' },
      },
    },
  },
]

// ─── guardas contra id inventado ──────────────────────────────────────────────
// Em 04/08 o modelo mandou o TIMESTAMP do nome do arquivo da foto como car_id
// ("1785792383826", tirado da URL que estava no histórico) e o INSERT do
// agendamento quebrou inteiro com 22P02. Aqui o id inválido é descartado em vez
// de derrubar a operação — a visita é agendada, só sem vínculo com o carro.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function asUuidOrNull(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return UUID_RE.test(s) ? s : null;
}

// O histórico guarda "[foto] https://.../1785792383826-8j1bx.jpg". Esse número
// vira candidato a id na cabeça do modelo. O banco mantém a URL (auditoria);
// o modelo recebe só o marcador.
function stripMediaUrls(text: string): string {
  return text
    .replace(/^\[foto\]\s*https?:\/\/\S+/i, '[foto enviada ao cliente]')
    .replace(/^\[v[íi]deo\]\s*https?:\/\/\S+/i, '[vídeo enviado ao cliente]');
}

// ─── execução das ferramentas ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = ReturnType<typeof createClient<any>>

// Calcula os horários LIVRES de uma data lendo a config da loja (business_hours
// + exceções + dias que abre + agendamentos). Fonte única usada tanto pelo
// ver_horarios_disponiveis quanto pela validação do agendar_visita — nada
// hardcoded, cada loja com a sua agenda. Para "hoje", remove horários já passados.
async function computeFreeSlots(
  supabase: SupabaseClient,
  userId: string,
  dateStr: string,
): Promise<{ open: boolean; reason?: string; dayLabel: string; freeSlots: string[] }> {
  const DOW_KEYS   = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  const DOW_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const dateObj  = new Date(`${dateStr}T12:00:00Z`);
  const dayKey   = DOW_KEYS[dateObj.getUTCDay()];
  const dayLabel = DOW_LABELS[dateObj.getUTCDay()];

  const { data: settings } = await supabase
    .from('company_settings')
    .select('business_hours, appointment_duration, appointment_interval, max_appointments_per_slot, working_days, business_hours_start, business_hours_end')
    .eq('user_id', userId)
    .single();

  // Exceção da data (feriado ou horário especial — ex.: domingo que abre)
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
      return { open: false, reason: exception.note || 'a loja está fechada nesse dia', dayLabel, freeSlots: [] };
    }
    slotStart = String(exception.start_time ?? '09:00');
    slotEnd   = String(exception.end_time   ?? '18:00');
  } else {
    type DayHours = { open?: boolean; start?: string; end?: string };
    const bh = settings?.business_hours as Record<string, DayHours> | null;
    const dayHours = bh?.[dayKey];

    if (!dayHours?.open) {
      if (!bh) {
        // business_hours não configurado — usa campos legados
        const LEGACY_MAP: Record<string, string> = {
          sun: 'Dom', mon: 'Seg', tue: 'Ter', wed: 'Qua', thu: 'Qui', fri: 'Sex', sat: 'Sáb',
        };
        const workingDays = String(settings?.working_days ?? 'Seg,Ter,Qua,Qui,Sex')
          .split(',').map((s: string) => s.trim());
        if (!workingDays.includes(LEGACY_MAP[dayKey] ?? '')) {
          return { open: false, reason: `a loja não abre ${dayLabel === 'Sábado' || dayLabel === 'Domingo' ? 'no' : 'na'} ${dayLabel.toLowerCase()}`, dayLabel, freeSlots: [] };
        }
        slotStart = String(settings?.business_hours_start ?? '09:00');
        slotEnd   = String(settings?.business_hours_end   ?? '18:00');
      } else {
        return { open: false, reason: `a loja não abre ${dayLabel === 'Sábado' || dayLabel === 'Domingo' ? 'no' : 'na'} ${dayLabel.toLowerCase()}`, dayLabel, freeSlots: [] };
      }
    } else {
      slotStart = dayHours.start ?? '09:00';
      slotEnd   = dayHours.end   ?? '18:00';
    }
  }

  const duration = Number(settings?.appointment_duration ?? 60);
  const interval = Number(settings?.appointment_interval ?? 15);
  let slots = generateTimeSlots(slotStart, slotEnd, duration, interval);

  // Se a data for HOJE (fuso de Brasília), remove horários que já passaram.
  const { iso: todayIso } = getBrazilDateInfo();
  if (dateStr === todayIso) {
    const nowHm = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date()); // "HH:MM"
    slots = slots.filter((s) => s > nowHm);
  }

  const maxPerSlot = Number(settings?.max_appointments_per_slot ?? 1);
  const { data: existingAppts } = await supabase
    .from('appointments')
    .select('appointment_time')
    .eq('user_id', userId)
    .eq('appointment_date', dateStr)
    .neq('status', 'cancelled');

  const count = new Map<string, number>();
  for (const a of (existingAppts ?? [])) {
    const t = String(a.appointment_time).substring(0, 5);
    count.set(t, (count.get(t) ?? 0) + 1);
  }
  const freeSlots = slots.filter((s) => (count.get(s) ?? 0) < maxPerSlot);
  return { open: true, dayLabel, freeSlots };
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { userId: string; conversationId: string; customerPhone: string; customerName: string | null; phoneNumberId: string; token: string; log: Logger },
  supabase: SupabaseClient,
): Promise<unknown> {
  const { userId, conversationId, customerPhone, customerName, phoneNumberId, token, log } = ctx;

  if (name === 'consultar_estoque') {
    // Teto de veículos por consulta. Existe pra não estourar o contexto numa loja
    // com estoque grande — mas o TOTAL REAL vai junto na resposta (count exact),
    // senão o bot anuncia o teto como se fosse o estoque inteiro ("temos 10
    // veículos" numa loja com 16, que foi o que aconteceu em 05/08).
    const LIMITE_ESTOQUE = 20;

    // Os mesmos filtros valem pra busca dos carros E pro resumo agregado.
    // 'categoria' (sedan/hatch/SUV/picape) não tem coluna no schema — aceito como
    // intenção, o filtro real é por marca/preço/ano. Ignorado pra não quebrar.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comFiltros = (q: any) => {
      if (input.marca)       q = q.ilike('brand', `%${input.marca}%`);
      if (input.modelo)      q = q.ilike('model', `%${input.modelo}%`);
      if (input.preco_min)   q = q.gte('price', Number(input.preco_min));
      if (input.preco_max)   q = q.lte('price', Number(input.preco_max));
      if (input.ano_min)     q = q.gte('year',  Number(input.ano_min));
      if (input.ano_max)     q = q.lte('year',  Number(input.ano_max));
      if (input.tipo)        q = q.eq('vehicle_type', String(input.tipo));
      if (input.combustivel) q = q.ilike('fuel', `%${input.combustivel}%`);
      if (input.cambio)      q = q.ilike('transmission', `%${input.cambio}%`);
      return q;
    };

    const { data, error, count } = await comFiltros(
      supabase
        .from('cars')
        .select(
          'id, brand, model, version, year, price, mileage, transmission, fuel, color, vehicle_type, status, description, car_images(id)',
          { count: 'exact' },
        )
        .eq('user_id', userId)
        .in('status', ['available', 'reserved'])
        .order('price', { ascending: true })
        .limit(LIMITE_ESTOQUE),
    );
    if (error) {
      log.error('falha ao buscar estoque', { action: 'consultar_estoque', error });
      return { erro: 'Falha ao buscar estoque' };
    }
    const totalReal = count ?? data?.length ?? 0;
    log.info('estoque consultado', {
      action: 'consultar_estoque', filtros: input,
      totalReal, exibindo: data?.length ?? 0,
    });
    if (!data?.length) return { mensagem: 'Nenhum veículo encontrado com esses critérios.' };

    // ── MODO RESUMO ──────────────────────────────────────────────────────────
    // Acima do teto, mandar a lista sairia caro (cada veículo ~90 tokens: 40 carros
    // = 3.600, 200 = 18.000, mais que o prompt inteiro) e ainda mostraria só os mais
    // baratos — o pior recorte pro lojista. Em vez disso vai o MAPA do estoque, que
    // custa ~250 tokens e força o bot a fazer o que um vendedor faz: perguntar o que
    // a pessoa procura antes de mostrar.
    // Pergunta ABERTA ("o que vocês têm?") vira resumo já com poucos carros: mais
    // de 6 itens no WhatsApp é textão, e qualificar antes é o comportamento certo.
    // Se o cliente JÁ estreitou ("quero um Gol"), ele fez a lição de casa —
    // resumir de novo seria empurrar pergunta em quem já respondeu; aí lista até 20.
    const temFiltro = Boolean(
      input.marca || input.modelo || input.preco_min || input.preco_max ||
      input.ano_min || input.ano_max || input.tipo || input.combustivel || input.cambio,
    );
    const LIMITE_LISTA = temFiltro ? LIMITE_ESTOQUE : 6;

    if (totalReal > LIMITE_LISTA) {
      const { data: todos } = await comFiltros(
        supabase.from('cars').select('price, brand, model, year, vehicle_type')
          .eq('user_id', userId).in('status', ['available', 'reserved'])
          .order('price', { ascending: true }),
      );
      const linhas = (todos ?? []) as Array<{ price: number | null; brand: string | null; model: string | null; year: number | null; vehicle_type: string | null }>;
      const precos = linhas.map((l) => Number(l.price)).filter((p) => p > 0);

      const FAIXAS: Array<[string, number, number]> = [
        ['até R$ 30 mil',      0,     30000],
        ['R$ 30 a 50 mil',     30000, 50000],
        ['R$ 50 a 80 mil',     50000, 80000],
        ['acima de R$ 80 mil', 80000, Infinity],
      ];
      const faixas = FAIXAS
        .map(([faixa, min, max]) => ({
          faixa,
          quantidade: precos.filter((p) => p >= min && p < max).length,
        }))
        .filter((f) => f.quantidade > 0);

      const contarPor = (campo: 'brand' | 'vehicle_type') => {
        const mapa = new Map<string, number>();
        for (const l of linhas) {
          const v = String(l[campo] ?? '').trim();
          if (v) mapa.set(v, (mapa.get(v) ?? 0) + 1);
        }
        return [...mapa.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([nome, quantidade]) => ({ nome, quantidade }));
      };

      // 2-3 exemplos que mostram a amplitude (mais barato, meio, mais caro).
      // Sem isso a resposta vira interrogatório seco; com eles o bot consegue dar
      // uma amostra concreta ANTES de perguntar, que é como um vendedor fala.
      const rotulo = (l: typeof linhas[number]) =>
        `${[l.brand, l.model].filter(Boolean).join(' ').trim()}${l.year ? ` ${l.year}` : ''} — R$ ${Number(l.price).toLocaleString('pt-BR')}`;
      const idxs = linhas.length >= 3
        ? [0, Math.floor(linhas.length / 2), linhas.length - 1]
        : linhas.map((_, i) => i);
      const exemplos = [...new Set(idxs)].map((i) => rotulo(linhas[i]));

      log.info('estoque em modo resumo', { action: 'consultar_estoque', totalReal, comFiltro: temFiltro, faixas: faixas.length });
      return {
        modo: 'resumo',
        total: totalReal,
        faixas_de_preco: faixas,
        marcas: contarPor('brand'),
        tipos: contarPor('vehicle_type'),
        preco_min: precos.length ? Math.min(...precos) : null,
        preco_max: precos.length ? Math.max(...precos) : null,
        exemplos,
        instrucao: `São ${totalReal} veículos nesse critério — NÃO liste todos. Diga o total, cite 1 ou 2 dos "exemplos" pra mostrar a amplitude do que a loja tem, e faça UMA pergunta pra estreitar (faixa de preço, marca ou tipo). Com a resposta, chame consultar_estoque de novo com o filtro e aí sim apresente os carros.`,
      };
    }

    // O builder do comFiltros é `any`, então as linhas voltam sem tipo — nomeia aqui
    // pra não perder a checagem nos dois map() abaixo.
    type CarListRow = {
      id: string; brand: string | null; model: string | null; version: string | null;
      year: number | null; price: number | null; mileage: number | null;
      transmission: string | null; fuel: string | null; color: string | null;
      vehicle_type: string | null; status: string | null; description: string | null;
      car_images: unknown[] | null;
    };

    // Cruza agendamentos FUTUROS por carro → urgência real ("já tem gente vindo ver").
    const carIds = (data as CarListRow[]).map((c) => c.id);
    const { iso: hojeIso } = getBrazilDateInfo();
    const visitasPorCarro = new Map<string, { quantas: number; proxima: string }>();
    if (carIds.length) {
      const { data: appts } = await supabase
        .from('appointments')
        .select('car_id, appointment_date, appointment_time')
        .eq('user_id', userId)
        .in('car_id', carIds)
        .in('status', ['scheduled', 'confirmed'])
        .gte('appointment_date', hojeIso)
        .order('appointment_date', { ascending: true })
        .order('appointment_time', { ascending: true });
      for (const a of (appts ?? [])) {
        const cid = String(a.car_id);
        const cur = visitasPorCarro.get(cid);
        if (cur) cur.quantas += 1;
        else visitasPorCarro.set(cid, {
          quantas: 1,
          proxima: `${a.appointment_date} ${String(a.appointment_time).substring(0, 5)}`,
        });
      }
    }

    return {
      // total = o que a loja REALMENTE tem nesse filtro; exibindo = o que veio aqui.
      total: totalReal,
      exibindo: data.length,
      ...(totalReal > data.length
        ? { aviso: `A loja tem ${totalReal} veículos nesse critério; estes são os ${data.length} mais baratos. Ao falar o número, use ${totalReal} — e ofereça filtrar (marca, faixa de preço, ano) pra mostrar os outros.` }
        : {}),
      veiculos: (data as CarListRow[]).map((c) => {
        const v = visitasPorCarro.get(String(c.id));
        return {
          id: c.id,
          marca: c.brand,
          modelo: c.model,
          versao: c.version,
          ano: c.year,
          preco: c.price,
          km: c.mileage,
          cambio: c.transmission,
          combustivel: c.fuel,
          // Observações que a loja escreveu sobre ESTE veículo (opcionais, estado,
          // detalhes de negociação). É informação que só existe aqui — use.
          // Em lista longa vai cortada (20 carros × 200 chars ≈ 1.200 tokens só
          // disso); quando o cliente estreita pra poucos carros, vai inteira.
          observacoes: c.description
            ? (data.length > 5 ? `${String(c.description).slice(0, 180)}…` : String(c.description))
            : null,
          cor: c.color,
          tipo: (c.vehicle_type as string) === 'moto' ? 'moto' : 'carro',
          status: c.status === 'available' ? 'disponível' : 'reservado',
          fotos: Array.isArray(c.car_images) ? c.car_images.length : 0,
          visita_agendada: v ? { tem: true, proxima_data: v.proxima, quantas: v.quantas } : { tem: false },
        };
      }),
    };
  }

  if (name === 'ver_horarios_disponiveis') {
    const dateStr = String(input.data ?? '');
    if (!dateStr) return { erro: 'Data não fornecida' };

    const { open, reason, dayLabel, freeSlots } = await computeFreeSlots(supabase, userId, dateStr);
    if (!open) {
      return { closed: true, disponivel: false, reason, mensagem: `Nesse dia ${reason}. Ofereça outro dia dentro do funcionamento da loja.` };
    }
    log.info('horários livres', { action: 'ver_horarios_disponiveis', data: dateStr, livres: freeSlots.length });
    return { data: dateStr, dia_semana: dayLabel, horarios_livres: freeSlots, total_disponivel: freeSlots.length };
  }

  if (name === 'agendar_visita') {
    const dateStr     = String(input.data    ?? '');
    const horario     = String(input.horario ?? '');
    const nomeCliente = String(input.nome_cliente ?? customerName ?? 'Cliente');
    const carId       = asUuidOrNull(input.car_id);
    if (input.car_id && !carId) {
      log.warn('car_id inválido descartado (agendamento segue sem vínculo)', {
        action: 'agendar_visita', carIdRecebido: String(input.car_id).slice(0, 40),
      });
    }

    log.info('params', { action: 'agendar_visita', data: dateStr, horario, nome: maskName(nomeCliente), carId });

    if (!dateStr || !horario) {
      log.error('data ou horário ausente', { action: 'agendar_visita', data: dateStr, horario });
      return { sucesso: false, error: 'Data ou horário não informado.' };
    }

    // VALIDAÇÃO de expediente + disponibilidade (mesma fonte do ver_horarios_disponiveis):
    // o horário pedido PRECISA ser um slot válido e livre. Barra fora do funcionamento,
    // dia fechado, exceção e horário já passado hoje — independente do que o modelo mandar.
    const horarioHm = horario.substring(0, 5);
    const slotInfo = await computeFreeSlots(supabase, userId, dateStr);

    if (!slotInfo.open) {
      log.warn('dia fechado/indisponível', { action: 'agendar_visita', data: dateStr, reason: slotInfo.reason });
      return { sucesso: false, fora_expediente: true, mensagem: `Não dá pra agendar em ${dateStr}: ${slotInfo.reason}. Ofereça ao cliente outro dia dentro do funcionamento da loja (use ver_horarios_disponiveis).` };
    }

    if (!slotInfo.freeSlots.includes(horarioHm)) {
      log.warn('fora do expediente/indisponível', { action: 'agendar_visita', horario: horarioHm, livres: slotInfo.freeSlots });
      return {
        sucesso: false,
        fora_expediente: true,
        horarios_livres: slotInfo.freeSlots,
        mensagem: `O horário ${horarioHm} não está disponível (fora do horário de funcionamento ou já ocupado). NÃO confirme esse horário. Ofereça ao cliente um destes horários válidos: ${slotInfo.freeSlots.join(', ') || '(nenhum nesse dia — sugira outro dia)'}.`,
      };
    }

    // booking_mode define o status do agendamento
    const { data: settings } = await supabase
      .from('company_settings')
      .select('booking_mode')
      .eq('user_id', userId)
      .single();

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
    log.info('inserindo', { action: 'agendar_visita', insertData });

    const { data: appt, error } = await supabase
      .from('appointments')
      .insert(insertData)
      .select()
      .single();

    log.info('resultado', { action: 'agendar_visita', appt, error });

    // BUG 1: se o INSERT falhar, retorna erro REAL ao Claude — nunca finge sucesso
    if (error || !appt) {
      log.error('insert falhou', { action: 'agendar_visita', error });
      return { sucesso: false, error: `Falha ao salvar o agendamento no banco: ${error?.message ?? 'desconhecido'}` };
    }

    log.info('agendamento criado', { action: 'agendar_visita', apptId: appt.id, data: appt.appointment_date, horario: appt.appointment_time });

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

  if (name === 'request_schedule_check') {
    const requestedDatetime = String(input.requested_datetime ?? '').trim();
    const customerContext   = String(input.customer_message ?? '').trim();
    if (!requestedDatetime) return { sucesso: false, mensagem: 'Data/hora não informada.' };

    // GUARDA: só escala se o horário estiver REALMENTE cheio segundo a config da
    // loja. Concessionária com max_appointments_per_slot > 1 atende várias pessoas
    // no mesmo horário — ter 1 visita marcada NÃO significa ocupado. Sem isto, o
    // modelo escalava horário livre e o cliente esperava o "superior" à toa.
    // Mesma fonte de verdade do ver_horarios_disponiveis e do agendar_visita.
    const [reqDate, reqTimeRaw] = requestedDatetime.split('T');
    const reqTime = String(reqTimeRaw ?? '').substring(0, 5);
    if (reqDate && reqTime) {
      const slotInfo = await computeFreeSlots(supabase, userId, reqDate);
      if (slotInfo.open && slotInfo.freeSlots.includes(reqTime)) {
        log.warn('escalonamento barrado — horário livre pela config da loja', {
          action: 'request_schedule_check', data: reqDate, horario: reqTime,
        });
        return {
          sucesso: false,
          horario_livre: true,
          mensagem: `O horário ${reqTime} do dia ${reqDate} ESTÁ LIVRE (esta loja atende mais de um cliente no mesmo horário). NÃO escale e NÃO diga que vai verificar com ninguém: chame agendar_visita AGORA com esse horário.`,
        };
      }
    }

    const payload = {
      requested_datetime: requestedDatetime,
      requested_at:       new Date().toISOString(),
      customer_context:   customerContext || null,
    };
    const { error } = await supabase
      .from('conversations')
      .update({ pending_schedule_check: payload })
      .eq('id', conversationId);

    if (error) {
      log.error('erro ao salvar', { action: 'request_schedule_check', error });
      return { sucesso: false, mensagem: 'Não consegui registrar agora. Tente de novo em instantes.' };
    }
    log.info('registrado', { action: 'request_schedule_check', requestedDatetime });
    return {
      sucesso: true,
      mensagem: 'Registrado. Diga ao cliente que vai verificar com seu superior e responde em alguns minutos. NÃO ofereça outro horário agora nem fale em atendente/sistema.',
    };
  }

  if (name === 'cancelar_visita') {
    const reason = String(input.reason ?? '').trim();
    const { iso: todayIso } = getBrazilDateInfo();
    const in7 = new Intl.DateTimeFormat('sv-SE').format(new Date(Date.parse(`${todayIso}T12:00:00`) + 7 * 86400000));

    // Agendamento mais próximo do cliente (próximos 7 dias, ainda ativo)
    const { data: appt } = await supabase
      .from('appointments')
      .select('id, appointment_date, appointment_time, notes')
      .eq('user_id', userId)
      .eq('customer_phone', customerPhone)
      .in('status', ['scheduled', 'confirmed'])
      .gte('appointment_date', todayIso)
      .lte('appointment_date', in7)
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!appt) {
      log.info('nenhum agendamento ativo', { action: 'cancelar_visita' });
      return { sucesso: false, mensagem: 'Nenhuma visita agendada encontrada para cancelar.' };
    }

    const notaCancel = reason ? `Cancelado pelo cliente: ${reason}` : 'Cancelado pelo cliente';
    const novaNota = appt.notes ? `${appt.notes}\n${notaCancel}` : notaCancel;

    const { error } = await supabase
      .from('appointments')
      .update({ status: 'cancelled', notes: novaNota })
      .eq('id', appt.id);

    if (error) {
      log.error('erro ao cancelar', { action: 'cancelar_visita', error });
      return { sucesso: false, error: 'Falha ao cancelar o agendamento.' };
    }

    log.info('cancelado', { action: 'cancelar_visita', apptId: appt.id, data: appt.appointment_date, horario: appt.appointment_time });
    return {
      sucesso: true,
      data: appt.appointment_date,
      horario: String(appt.appointment_time).substring(0, 5),
      mensagem: 'Visita cancelada.',
    };
  }

  if (name === 'registrar_interesse') {
    const nome       = input.nome ? String(input.nome) : (customerName ?? 'Cliente WhatsApp');
    const carId      = asUuidOrNull(input.car_id);
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
    const veiculoId    = asUuidOrNull(input.veiculo_id);
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

  if (name === 'simular_financiamento') {
    const carPrice = Number(input.car_price ?? 0);
    const downPayment = Number(input.down_payment ?? 0);
    const tradeIn = Number(input.trade_in_value ?? 0);

    const { data: cfg } = await supabase
      .from('company_settings')
      .select('financing_enabled, financing_interest_rate, financing_max_installments, financing_min_down_payment_percent')
      .eq('user_id', userId).single();

    // Desligado → fallback: coletar + escalar (não calcula)
    if (!cfg || cfg.financing_enabled !== true) {
      return { disponivel: false, mensagem: 'Simulação automática não está ativa. Colete entrada/prazo e acione chamar_atendente pra um especialista simular.' };
    }
    if (!carPrice || carPrice <= 0) {
      return { sucesso: false, mensagem: 'Preço do carro não informado — use consultar_estoque e passe o car_price.' };
    }

    const taxa   = Number(cfg.financing_interest_rate ?? 0);
    const maxN   = Number(cfg.financing_max_installments ?? 48);
    const minPct = Number(cfg.financing_min_down_payment_percent ?? 0);

    let n = Number(input.installments ?? maxN) || maxN;
    if (n > maxN) n = maxN; // teto de parcelas

    const entradaTotal = downPayment + tradeIn;
    const minEntrada   = carPrice * (minPct / 100);

    // Validação: entrada mínima (dinheiro + troca)
    if (minPct > 0 && entradaTotal < minEntrada) {
      log.info('entrada insuficiente', { action: 'simular_financiamento', entradaTotal, entradaMinima: Math.round(minEntrada), minPct });
      return {
        sucesso: false, entrada_insuficiente: true,
        entrada_informada: entradaTotal,
        entrada_minima: Math.round(minEntrada),
        entrada_minima_percent: minPct,
        mensagem: `Entrada (dinheiro + troca = R$ ${entradaTotal.toLocaleString('pt-BR')}) abaixo do mínimo de ${minPct}% (R$ ${Math.round(minEntrada).toLocaleString('pt-BR')}). Diga o mínimo e pergunte se consegue complementar. NÃO calcule abaixo do mínimo.`,
      };
    }

    const valorFinanciado = Math.max(0, carPrice - entradaTotal);
    const parcela = calcParcelaPrice(valorFinanciado, taxa, n);

    log.info('simulação calculada', {
      action: 'simular_financiamento',
      preco: carPrice,
      entrada: entradaTotal,
      financiado: valorFinanciado,
      taxaMes: taxa,
      parcelas: n,
      parcela: Math.round(parcela * 100) / 100,
    });

    // Salva no lead (na qualificação financeira — financial_info)
    try {
      const { data: lead } = await supabase.from('leads')
        .select('id, financial_info').eq('user_id', userId).eq('phone', customerPhone).maybeSingle();
      if (lead) {
        const resumo = `Simulação: ${n}x de R$ ${parcela.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} | entrada R$ ${entradaTotal.toLocaleString('pt-BR')} (dinheiro ${downPayment.toLocaleString('pt-BR')} + troca ${tradeIn.toLocaleString('pt-BR')}) | financiado R$ ${valorFinanciado.toLocaleString('pt-BR')} | taxa ${taxa}%/mês`;
        const novo = lead.financial_info ? `${lead.financial_info}\n${resumo}` : resumo;
        await supabase.from('leads').update({ financial_info: novo, updated_at: new Date().toISOString() }).eq('id', lead.id);
      }
    } catch (e) { log.error('erro ao salvar simulação no lead', { action: 'simular_financiamento', error: e }); }

    return {
      sucesso: true,
      valor_financiado: Math.round(valorFinanciado),
      parcelas: n,
      valor_parcela: Math.round(parcela * 100) / 100,
      disclaimer: 'Esta é uma simulação aproximada. O valor exato depende da análise de crédito do banco e do perfil do cliente.',
      mensagem: 'Apresente como ESTIMATIVA + disclaimer e convide pra confirmar na loja. Nunca diga que é o valor final.',
    };
  }

  if (name === 'chamar_atendente') {
    await supabase
      .from('conversations')
      .update({ status: 'pending' })
      .eq('id', conversationId);

    return { sucesso: true, mensagem: 'Atendente chamado. O cliente será notificado.' };
  }

  if (name === 'enviar_midia_carro') {
    const carId  = String(input.car_id ?? '');
    const marca  = String(input.marca ?? '').trim();
    const modelo = String(input.modelo ?? '').trim();
    log.info('enviando mídia', { action: 'enviar_midia_carro', carId, marca, modelo });

    if (!carId && !modelo && !marca) return { success: false, error: 'ID do carro não fornecido' };

    const CAR_COLS = 'id, brand, model, specs_image_url, video_url, user_id';
    type CarRow = { id: string; brand: string | null; model: string | null; specs_image_url: string | null; video_url: string | null };
    let car: CarRow | null = null;

    // 1. Busca pelo id (só do dono do bot)
    if (carId) {
      const { data, error: carErr } = await supabase
        .from('cars')
        .select(CAR_COLS)
        .eq('id', carId)
        .eq('user_id', userId)
        .single();
      if (data) {
        car = data as CarRow;
      } else {
        log.warn('car_id fantasma — tentando recuperar por marca/modelo', { action: 'enviar_midia_carro', carId, marca, modelo, error: carErr?.message });
      }
    }

    // 1b. Plano B: id falhou (alucinado ou de turno antigo) — recupera por marca/modelo
    //     entre os carros ativos do tenant (mesma ordenação do consultar_estoque).
    if (!car && (modelo || marca)) {
      let fq = supabase
        .from('cars')
        .select(CAR_COLS)
        .eq('user_id', userId)
        .in('status', ['available', 'reserved'])
        .order('price', { ascending: true })
        .limit(2);
      if (marca)  fq = fq.ilike('brand', `%${marca}%`);
      if (modelo) fq = fq.ilike('model', `%${modelo}%`);
      const { data: matches } = await fq;
      if (matches?.length) {
        car = matches[0] as CarRow;
        log.warn('car_id fantasma recuperado por marca/modelo', {
          action: 'enviar_midia_carro', carId, marca, modelo,
          recoveredCarId: car.id, matches: matches.length,
        });
      }
    }

    if (!car) {
      log.warn('veículo não encontrado (car_id inválido/alucinado?)', { action: 'enviar_midia_carro', carId, marca, modelo });
      return { success: false, error: 'Veículo não encontrado. Chame consultar_estoque, pegue o id correto e tente de novo com marca e modelo.' };
    }
    const resolvedCarId = String(car.id);
    log.debug('carro carregado', { action: 'enviar_midia_carro', car });

    const carName = [car.brand, car.model].filter(Boolean).join(' ') || 'veículo';
    const videoUrl: string | null = car.video_url;

    // 2. Monta a GALERIA: a imagem de especificações primeiro (quando existe) e
    //    depois as fotos cadastradas, na ordem definida pela loja.
    //    Antes daqui só saía UMA foto (a de specs OU a primeira da galeria) — o
    //    cliente pedia "não tem mais foto?" e recebia a mesma de novo.
    //    Teto igual ao máximo que o painel deixa cadastrar (8): assim a contagem
    //    que o consultar_estoque informa ao bot ("fotos: 4") sempre bate com o
    //    que realmente sai — o bot não anuncia foto que não vai mandar.
    const MAX_FOTOS = 8;
    const fotos: string[] = [];
    if (car.specs_image_url) fotos.push(String(car.specs_image_url));

    const { data: galeria } = await supabase
      .from('car_images')
      .select('image_url')
      .eq('car_id', resolvedCarId)
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
      .limit(MAX_FOTOS);
    for (const img of (galeria ?? [])) {
      const u = String(img.image_url ?? '').trim();
      if (u && !fotos.includes(u)) fotos.push(u);   // dedupe: specs pode repetir a 1ª
    }
    const paraEnviar = fotos.slice(0, MAX_FOTOS);

    // 3. Sem nada cadastrado — NÃO é erro técnico, é só ausência de mídia.
    if (!paraEnviar.length && !videoUrl) {
      log.info('veículo sem mídia cadastrada', { action: 'enviar_midia_carro', carId: resolvedCarId });
      return { success: false, sem_midia: true, message: 'Este veículo não tem foto nem vídeo cadastrados (ausência de mídia, não é falha técnica).' };
    }

    const sentItems: string[] = [];
    const pid = phoneNumberId || undefined;
    let fotosEnviadas = 0;

    // 4. Fotos, uma a uma e em ordem
    for (const url of paraEnviar) {
      try {
        const ok = await sendImage(customerPhone, url, pid, token, log);
        if (ok) {
          fotosEnviadas++;
          await supabase.from('messages').insert({
            conversation_id: conversationId, role: 'bot', content: `[foto] ${url}`,
          });
          // Pausa curta pra chegarem na ordem certa no aparelho do cliente.
          await new Promise((r) => setTimeout(r, 700));
        }
      } catch (e) {
        log.error('erro ao enviar foto', { action: 'enviar_midia_carro', carId: resolvedCarId, url, error: e });
      }
    }
    if (fotosEnviadas > 0) {
      sentItems.push(fotosEnviadas === 1 ? '1 foto' : `${fotosEnviadas} fotos`);
      if (videoUrl) await new Promise((r) => setTimeout(r, 800)); // separa das fotos
    }

    // 5. Vídeo depois
    if (videoUrl) {
      try {
        const ok = await sendVideo(customerPhone, videoUrl, pid, undefined, token, log);
        if (ok) {
          sentItems.push('vídeo');
          await supabase.from('messages').insert({
            conversation_id: conversationId, role: 'bot', content: `[vídeo] ${videoUrl}`,
          });
        }
      } catch (e) {
        log.error('erro ao enviar vídeo', { action: 'enviar_midia_carro', carId: resolvedCarId, error: e });
      }
    }

    if (sentItems.length === 0) {
      return { success: false, error: 'Falha ao enviar as mídias' };
    }

    log.info('mídia enviada', {
      action: 'enviar_midia_carro', carId: resolvedCarId,
      sent: sentItems, fotosEnviadas, fotosDisponiveis: paraEnviar.length,
    });
    return {
      success: true,
      sent: sentItems,
      fotos_enviadas: fotosEnviadas,
      // O bot já prometeu "são 4 fotos" tendo mandado 1. Esta linha é a verdade
      // do que saiu — não invente quantidade nem prometa mandar mais depois.
      message: `Enviei ${sentItems.join(' e ')} do ${carName}. Essas são TODAS as fotos que tenho pra mandar deste veículo — não prometa outras. Se o cliente quiser ver mais ângulos, convide pra ver o carro pessoalmente na loja.`,
    };
  }

  if (name === 'registrar_interesse_veiculo') {
    const model = String(input.model ?? '').trim();
    log.info('registrando interesse', { action: 'registrar_interesse_veiculo', model, brand: input.brand });
    log.debug('params completos', { action: 'registrar_interesse_veiculo', input });

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
        log.error('erro no update do interesse', { action: 'registrar_interesse_veiculo', interestId: existing.id, error });
        return { success: false, error: 'Não consegui salvar o interesse agora. Diga que vai resolver isso pessoalmente e acione chamar_atendente.' };
      }
      log.info('interesse atualizado', { action: 'registrar_interesse_veiculo', interestId: existing.id, model });
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

    if (error || !created) {
      log.error('erro no insert do interesse', { action: 'registrar_interesse_veiculo', error });
      return { success: false, error: 'Falha ao salvar interesse no banco' };
    }
    log.info('interesse registrado', { action: 'registrar_interesse_veiculo', interestId: created.id, model });

    const anoInfo = fields.year_min ? ` ${fields.year_min}-${fields.year_max ?? fields.year_min}` : '';
    return { success: true, action: 'created', message: `Interesse registrado: ${model}${anoInfo}.` };
  }

  if (name === 'save_lead_qualification') {
    const map: Record<string, string> = {};
    if (String(input.family ?? '').trim())     map.family_info     = String(input.family).trim();
    if (String(input.occupation ?? '').trim()) map.occupation      = String(input.occupation).trim();
    if (String(input.recreation ?? '').trim()) map.recreation_info = String(input.recreation).trim();
    if (String(input.financial ?? '').trim())  map.financial_info  = String(input.financial).trim();
    if (Object.keys(map).length === 0) return { sucesso: false, mensagem: 'Nada para salvar.' };

    try {
      const { data: existing, error: readErr } = await supabase
        .from('leads').select('id').eq('user_id', userId).eq('phone', customerPhone).maybeSingle();

      if (readErr) {
        log.error('falha ao ler lead (qualificação)', { action: 'save_lead_qualification', error: readErr });
        return { sucesso: false, error: 'Não consegui acessar o cadastro do cliente.' };
      }

      if (existing) {
        const { data: updated, error: updErr } = await supabase
          .from('leads')
          .update({ ...map, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .select('id');

        const rows = updated?.length ?? 0;
        if (updErr || rows === 0) {
          log.error('falha no update da qualificação', { action: 'save_lead_qualification', leadId: existing.id, linhas: rows, campos: Object.keys(map), error: updErr });
          return { sucesso: false, error: 'Não consegui salvar a qualificação do cliente.' };
        }
        log.info('qualificação salva', { action: 'save_lead_qualification', leadId: existing.id, campos: Object.keys(map) });
        return { sucesso: true, campos: Object.keys(map), continuar: 'Dado salvo internamente. NÃO encerre o turno — comente brevemente e faça a PRÓXIMA pergunta (FORD/troca) ou siga o fluxo.' };
      }

      const { data: created, error: insErr } = await supabase
        .from('leads')
        .insert({ user_id: userId, name: customerName ?? 'Cliente WhatsApp', phone: customerPhone, status: 'novo', ...map })
        .select('id').single();

      if (insErr || !created) {
        log.error('falha no insert da qualificação', { action: 'save_lead_qualification', campos: Object.keys(map), error: insErr });
        return { sucesso: false, error: 'Não consegui salvar a qualificação do cliente.' };
      }
      log.info('qualificação salva (lead criado)', { action: 'save_lead_qualification', leadId: created.id, campos: Object.keys(map) });
      return { sucesso: true, campos: Object.keys(map), lead_id: created.id, continuar: 'Dado salvo internamente. NÃO encerre o turno — comente brevemente e faça a PRÓXIMA pergunta (FORD/troca) ou siga o fluxo.' };
    } catch (e) {
      log.error('exceção ao salvar qualificação', { action: 'save_lead_qualification', error: e });
      return { sucesso: false, error: 'Erro ao salvar a qualificação do cliente.' };
    }
  }

  if (name === 'save_trade_in_evaluation') {
    const map: Record<string, string> = {};
    if (String(input.model ?? '').trim())              map.trade_in_model = String(input.model).trim();
    if (String(input.year ?? '').trim())               map.trade_in_year = String(input.year).trim();
    if (String(input.km ?? '').trim())                 map.trade_in_km = String(input.km).trim();
    if (String(input.ownership_time ?? '').trim())     map.trade_in_ownership_time = String(input.ownership_time).trim();
    if (String(input.owner_rating ?? '').trim())       map.trade_in_owner_rating = String(input.owner_rating).trim();
    if (String(input.payment_preference ?? '').trim()) map.trade_in_payment_preference = String(input.payment_preference).trim();
    if (String(input.difference_payment ?? '').trim()) map.trade_in_difference_payment = String(input.difference_payment).trim();
    const extra = String(input.extra_info ?? '').trim();
    if (Object.keys(map).length === 0 && !extra) return { sucesso: false, mensagem: 'Nada para salvar.' };

    try {
      // Lê o lead atual (pra acumular extra_info e ter o id)
      const { data: existing, error: readErr } = await supabase
        .from('leads').select('id, trade_in_extra_info').eq('user_id', userId).eq('phone', customerPhone).maybeSingle();

      if (readErr) {
        log.error('falha ao ler lead (troca)', { action: 'save_trade_in_evaluation', error: readErr });
        return { sucesso: false, error: 'Não consegui acessar o cadastro do cliente.' };
      }

      if (extra) {
        const atual = existing?.trade_in_extra_info ? String(existing.trade_in_extra_info) : '';
        map.trade_in_extra_info = atual ? `${atual}\n${extra}` : extra; // acumula, não sobrescreve
      }

      if (existing) {
        // .select() devolve as linhas afetadas → dá pra contar (0 = falha silenciosa)
        const { data: updated, error: updErr } = await supabase
          .from('leads')
          .update({ ...map, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .select('id');

        const rows = updated?.length ?? 0;
        if (updErr || rows === 0) {
          // erro OU 0 linhas afetadas (RLS, id errado, coluna inexistente) = falha
          log.error('falha no update da avaliação de troca', { action: 'save_trade_in_evaluation', leadId: existing.id, linhas: rows, campos: Object.keys(map), error: updErr });
          return { sucesso: false, error: 'Não consegui salvar os dados do carro de troca.' };
        }
        log.info('avaliação de troca salva', { action: 'save_trade_in_evaluation', leadId: existing.id, campos: Object.keys(map) });
        return { sucesso: true, campos: Object.keys(map), continuar: 'Dado salvo internamente. NÃO encerre o turno — comente brevemente e faça a PRÓXIMA pergunta (FORD/troca) ou siga o fluxo.' };
      }

      // Sem lead ainda → cria
      const { data: created, error: insErr } = await supabase
        .from('leads')
        .insert({ user_id: userId, name: customerName ?? 'Cliente WhatsApp', phone: customerPhone, status: 'novo', ...map })
        .select('id').single();

      if (insErr || !created) {
        log.error('falha no insert da avaliação de troca', { action: 'save_trade_in_evaluation', campos: Object.keys(map), error: insErr });
        return { sucesso: false, error: 'Não consegui salvar os dados do carro de troca.' };
      }
      log.info('avaliação de troca salva (lead criado)', { action: 'save_trade_in_evaluation', leadId: created.id, campos: Object.keys(map) });
      return { sucesso: true, campos: Object.keys(map), lead_id: created.id, continuar: 'Dado salvo internamente. NÃO encerre o turno — comente brevemente e faça a PRÓXIMA pergunta (FORD/troca) ou siga o fluxo.' };
    } catch (e) {
      log.error('exceção ao salvar avaliação de troca', { action: 'save_trade_in_evaluation', error: e });
      return { sucesso: false, error: 'Erro ao salvar os dados do carro de troca.' };
    }
  }

  return { erro: `Ferramenta desconhecida: ${name}` };
}

// ─── system prompt ────────────────────────────────────────────────────────────

interface Faq { question: string; answer: string }

function buildSystemPrompt(settings: Record<string, unknown>, faqs: Faq[], customerName: string | null, log: Logger): string {
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

  const paymentMethods = Array.isArray(settings.payment_methods)
    ? (settings.payment_methods as unknown[]).map((m) => String(m).trim()).filter(Boolean)
    : [];
  // Diagnóstico BUG 2: registra nos logs o que foi lido do banco e o que entrou no prompt.
  log.debug('payment_methods do banco → prompt', { action: 'build_prompt', lido: settings.payment_methods ?? null, usados: paymentMethods });
  const paymentBlock = paymentMethods.length > 0
    ? `\n\n## Formas de pagamento aceitas pela loja\n\nFormas de pagamento aceitas pela loja: ${paymentMethods.join(', ')}.\n\nREGRA RÍGIDA sobre pagamento — siga ao pé da letra:\n- Responda SOMENTE com base na lista acima. Considere essa lista completa e exata.\n- NUNCA invente formas de pagamento, prazos (ex.: "18x", "48x", "em até 60x"), descontos, taxas ou condições especiais que não estejam EXPLICITAMENTE escritos na lista.\n- Se a lista NÃO tem "cartão de crédito" ou "cartão de débito", você NÃO pode mencionar cartão. Se não tem "consórcio", não cite consórcio. O mesmo vale para qualquer forma fora da lista.\n- Se um item está na lista sem prazo (ex.: "Financiamento bancário"), você NÃO pode dizer "em 48x" nem inventar número de parcelas — diga apenas que a loja trabalha com essa forma e que prazos/condições são confirmados pela equipe.\n- Se o cliente perguntar por algo que não está na lista, não afirme que a loja aceita — diga que vai confirmar com o gerente.`
    : '';

  // Qualificação FORD — só inclui as categorias com toggle ativo no tenant.
  const ford = (settings.ford_qualification && typeof settings.ford_qualification === 'object')
    ? settings.ford_qualification as Record<string, unknown>
    : null;
  const FORD_LINES: Record<string, string> = {
    family:     '- **F = Família** → quem usa o carro (define espaço, segurança, tipo). UMA pergunta por vez conforme o papo: "O carro é mais pra você no dia a dia ou pra família toda?", "Vocês são em quantos em casa?", "Tem criança? Aí espaço e segurança pesam mais." → save_lead_qualification({ family }).',
    occupation: '- **O = Ocupação = a PROFISSÃO/trabalho do cliente** (ex: "representante comercial", "professora", "motorista de app", "autônomo") — NÃO é o uso do carro (isso é Recreação). Pergunte SEMPRE com jeito e um conector natural, nunca seca; escolha o melhor momento. Ex: amarrando no uso → "E o carro é mais pro trabalho ou pessoal? E com o que você trabalha, se não for indiscrição?"; no financiamento → "Pra simulação, me conta com o que você trabalha?"; com leveza → "Posso te perguntar com o que você trabalha? Ajuda a entender o que encaixa melhor pra você". NUNCA pergunte salário/renda; se não quiser responder, siga sem insistir. Salve a PROFISSÃO em save_lead_qualification({ occupation }).',
    recreation: '- **R = Recreação/uso do carro** → COMO usa o carro (dia a dia, cidade, estrada, viagem, fim de semana) e o que curte fazer (conecta e revela a necessidade real). "Você usa mais na cidade ou pega estrada?", "Costuma viajar de carro?", "O que curte fazer no fim de semana?". Ex: viaja muito → porta-malas/conforto/estrada; vida urbana → economia/tamanho pra cidade. Salve o USO/lazer (NÃO a profissão) em save_lead_qualification({ recreation }).',
    financial:  '- **Forma de pagamento (DISCRETO, nunca pergunte salário)** → COMO pretende comprar: financiamento, à vista ou troca. "Tá pensando em financiar ou pagar à vista?", "Vai dar um carro na troca?". → save_lead_qualification({ financial }).',
  };
  // ford null (coluna ford_qualification / migração 021 não configurada) → assume
  // tudo ON (igual ao default da migração e ao trade-in); evita o bot deixar de
  // qualificar só porque o SQL não rodou. Se a coluna existir, respeita os toggles.
  const fordKeys = (['family', 'occupation', 'recreation', 'financial'] as const).filter((k) => ford ? ford[k] === true : true);
  const fordBlock = fordKeys.length > 0
    ? `\n\n## Qualificação natural do cliente (FORD)\n\nFORD é técnica de qualificação E rapport: descubra quem é o cliente pra recomendar o carro certo e criar conexão. Não é formulário — é conversa. Descubra naturalmente, SEM interrogatório, diluído ao longo do papo:\n\n${fordKeys.map((k) => FORD_LINES[k]).join('\n\n')}\n\n- **D = Desejos/Objetivo** → o gatilho emocional da compra (use pra RECOMENDAR e conectar): "O que é mais importante pra você num carro: economia, conforto, potência ou visual?", "Tem algum carro que sempre foi seu sonho?", "O que te faria bater o martelo?". Use isso pra apontar o carro certo do estoque. (Não há campo próprio — serve pra recomendação.)\n\nComo aplicar: ENCAIXE no contexto em vez de recitar (falou que viaja → puxa Recreação; falou dos filhos → cobre Família), e COMENTE a resposta antes de seguir, pra mostrar que ouviu: "Boa! Então espaço e segurança vão importar, já entendi." Uma pergunta de cada vez, sempre reagindo à anterior.`
    : '';

  // Pré-avaliação de troca — só inclui se o toggle estiver ativo no tenant.
  const tradeInEnabled = settings.trade_in_evaluation_enabled !== false; // default ON
  const tradeInExtra = String(settings.trade_in_extra_questions ?? '').trim();
  const tradeInBlock = tradeInEnabled
    ? `\n\n## Pré-avaliação do carro do cliente (quando há troca)\n\nQuando o cliente mencionar que TEM um carro pra dar de entrada/trocar/vender, OU quando você perceber que ele já tá decidido por um carro e ainda não falou sobre troca, descubra naturalmente as seguintes informações:\n\n1. **Modelo (marca e modelo)** — "E qual é o seu atual?", "Você tem o quê hoje?"\n2. **Ano** — "É de qual ano?"\n3. **Quilometragem aproximada** — "Tá com quantos km mais ou menos?"\n4. **Há quanto tempo é dono** — "Faz tempo que tá com ele?"\n5. **Nota de 0 a 10 que daria pro carro** — "Numa escala de 0 a 10, que nota você daria pra ele?"\n6. **Forma de pagamento desejada** — "Você quer trocar diretinho, ou já tá pensando em pagar uma diferença?"\n   - Se for diferença: "A diferença você quer pagar à vista ou financiar?"\n\nREGRAS importantes:\n- Distribua as perguntas ao longo da conversa, NÃO em sequência rápida (vira interrogatório)\n- Pergunte com naturalidade, frases curtas\n- Use a tool save_trade_in_evaluation pra ir salvando aos poucos cada informação que descobrir\n- Se o cliente mencionar algo extra sobre o carro (cor, modificações, "tá batidinho na lateral"), salve no campo extra_info`
      + (tradeInExtra ? `\n\n## Perguntas adicionais (configuradas pela loja)\n\nAlém das perguntas padrão acima, descubra também:\n${tradeInExtra}\n\nQuando obter resposta dessas perguntas extras, salve no campo extra_info junto com as outras informações extras.` : '')
    : '';

  const visitReminderBlock = `\n\n## Resposta do cliente ao lembrete de visita\n\nSe o cliente responde algo como "não vou poder ir", "preciso desmarcar", "vou cancelar", "tô com problema" ou "vou ter que remarcar" (normalmente após um lembrete de visita):\n\n1. Mostre empatia ("Tudo bem, imprevistos acontecem!").\n2. Pergunte: "Você prefere remarcar pra outro horário ou cancelar de vez?"\n3. Se quiser REMARCAR: chame a tool cancelar_visita (cancela o agendamento atual) e em seguida conduza uma nova marcação seguindo o fluxo normal (dia → período → confirmação).\n4. Se quiser CANCELAR: chame a tool cancelar_visita e responda algo acolhedor: "Sem problemas, fica pra próxima! Quando quiser voltar, é só me chamar."\n\nSe o cliente responder positivamente ("ok", "tô indo", "estou a caminho"), apenas confirme: "Perfeito, te esperamos! 😊"`;

  // Financiamento — bloco condicional ao toggle financing_enabled.
  const financingEnabled = settings.financing_enabled === true;
  const financingBlock = financingEnabled
    ? `2. Pra simular, pergunte UMA de cada vez só o que falta: entrada em dinheiro, se tem carro na troca, e prazo (sem prazo, usa o máximo da loja). NÃO peça CPF.\n3. Chame simular_financiamento com o car_price vindo do consultar_estoque. Se voltar entrada_insuficiente, diga o mínimo e pergunte se ele consegue complementar — nunca calcule abaixo dele.`
    : `2. Se o cliente quiser simular financiamento, COLETE um por vez: entrada, prazo e (opcional) o veículo. NÃO peça CPF.\n3. Depois chame coletar_dados_financiamento e em seguida chamar_atendente. Diga: "Já anotei seus dados! Em instantes um especialista entra em contato com a simulação exata 😊".`;

  const delayedEnabled = settings.delayed_schedule_enabled !== false; // default ON
  const busyTimeRule = delayedEnabled
    ? `5. **Quando o cliente pedir um horário que está OCUPADO** (você confirmou via ver_horarios_disponiveis que ele NÃO aparece em horarios_livres): NÃO descarte na hora nem ofereça alternativa imediatamente — chame request_schedule_check e responda só "Deixa eu verificar com meu superior, te respondo em alguns minutos." A confirmação ou as alternativas chegam ao cliente depois, automaticamente. ATENÇÃO: isto vale SÓ para horário OCUPADO. Se o horário estiver livre, siga a regra 6 (agendar na hora).`
    : `5. **Quando o cliente pedir um horário ocupado** (não está em horarios_livres): confirme via ver_horarios_disponiveis e, sem soar seco, já ofereça na hora 2 horários próximos livres (um antes, um depois), no mesmo tom humano ("deixa eu ver aqui... consigo te encaixar às X ou Y, qual prefere?"). NÃO use request_schedule_check. Se o horário estiver livre, siga a regra 6.`;

  const conductionBlock = `\n\n## Persona e tom

Você é um vendedor experiente da loja, NÃO um bot. Nunca se identifique como assistente virtual, IA, chatbot ou robô. Aja como uma pessoa real conduzindo o atendimento.

- NUNCA diga "vou chamar um atendente". Em vez disso: "deixa eu verificar com meu superior", "vou alinhar com o gerente", "deixa eu checar aqui".
- NUNCA mencione que você é automatizado, sistema, robô ou IA.
- Use linguagem natural, descontraída quando apropriado, sem soar formal demais.

## Como conduzir a conversa

Você conduz a conversa em microcompromissos, não lista opções. Regras:

1. **Sempre pergunte o nome do cliente no INÍCIO** (1ª ou 2ª mensagem) e use-o durante toda a conversa.
2. **Pra agendar visita, siga ESTA ordem rigorosa:**
   a) Primeiro o **dia**, em duas opções: "Quer vir hoje ou prefere amanhã?". Se recusar as duas, oferece outras duas próximas ("Que tal sexta ou sábado?"). Nunca liste a semana inteira.
   b) Depois o **período**, em duas opções concretas — uma de manhã e uma de tarde: "Fica melhor de manhã às 9h ou de tarde às 16h?". Se recusar as duas, oferece outras duas ("Tenho 11h ou 14h, qual prefere?").
3. **Outras decisões: perguntas binárias** quando possível ("À vista ou financiamento?", "É pra você ou pra família?", "Tem carro pra dar de entrada ou compra direto?").
4. **Microcompromissos contínuos:** cada mensagem leva o cliente um passo adiante ("Posso já deixar reservado pra você?", "Me passa seu nome pra confirmar?", "Tá fechado então pra [dia] às [hora]?").
${busyTimeRule}
6. **Horário LIVRE = agendar na hora, sem escalar e sem reconfirmar.** Assim que o cliente aceitar um horário que você ofereceu OU propuser um horário próprio (ex.: "prefiro 17h"), verifique em horarios_livres: se estiver livre (dentro do expediente), chame **agendar_visita IMEDIATAMENTE**. Tanto faz se o horário partiu de você ou do cliente — livre = agenda. Se ainda não checou aquele horário específico, chame ver_horarios_disponiveis antes; apareceu em horarios_livres, agende. Confirme os dados NO MÁXIMO UMA vez: com dia + horário livre + nome, agende direto, sem pedir "tá certo?" de novo. request_schedule_check é EXCLUSIVO pra horário OCUPADO — NUNCA pra horário livre, e NUNCA fale em "alinhar com o gerente" pra um horário que está livre.

## Postura de venda (você é um vendedor consultivo ATIVO)

Você CONDUZ a conversa — não espera o cliente puxar tudo. Siga o funil da seção "Fluxo de qualificação" abaixo, sempre valorizando o que TEM.

- **NUNCA se desvalorize.** Proibido falar "é acima do que você buscava", "é de outro nível", "estoque enxuto", "infelizmente não tenho", "não tenho esse". Em vez de apontar o que falta, apresente o que TEM como oportunidade. Ex: em vez de "não tenho compacto", diga "deixa eu te mostrar uma opção que tá valendo muito a pena aqui".
- **Valorize o carro ao apresentar.** Destaque benefícios reais com entusiasmo genuíno — equipamento, km baixa, ano, câmbio, economia — pra criar desejo. Mas SEM inventar, sem mentir, sem esconder informação: só apresente o que é verdade de forma atraente.
- **Contorne a PRIMEIRA objeção (1 vez), com jeito.** Se o cliente recusar, entenda o porquê e ofereça um ângulo novo OU outra opção real. Ex: "não gosto de Polo" → "entendi! e o que mais te chama num carro: economia, espaço ou um visual mais esportivo? Pergunto porque tenho [opção real] que pode combinar". Se recusar de novo / disser um "não" claro → RESPEITE, não insista uma terceira vez.

## Fluxo de qualificação (o funil — você CONDUZ, não espera)

Independente de como o cliente entra (pedindo um modelo, querendo "ver o estoque", ou já oferecendo o carro dele na troca), mantenha este funil — adaptando a ORDEM ao que ele trouxer primeiro, sem pular etapas:

1. **Nome** — pegue logo no início (e chame salvar_nome_cliente).
2. **Intenção** — entenda o que ele quer: um modelo específico ou explorar o estoque. Conduza com perguntas.
3. **Se não tiver o modelo exato** — registre o interesse (registrar_interesse_veiculo) E ofereça 1-2 alternativas REAIS e parecidas do estoque, com valor (ver a seção "Quando o cliente pede um carro que você não tem exatamente"). Foque no que TEM.
4. **Desperte interesse** — apresente o carro com benefícios reais (equipamento, km, ano, câmbio, economia — só verdades). Se recusar, contorne 1x com pergunta de sondagem e ofereça outra opção; respeite o "não" claro.
5. **Qualificação FORD** (quando houver interesse num carro) — descubra ao longo do papo, DILUÍDO (uma de cada vez, NUNCA um interrogatório): Família (é pra família? quantos costumam andar junto?), Ocupação (trabalha com quê / pra que vai usar), Recreação (cidade, viagem, fim de semana?), Objetivo (o que mais importa pra ele num carro). **A cada info que descobrir, CHAME save_lead_qualification** — não só converse, salve.
6. **Pagamento (PROATIVO)** — depois de qualificar, VOCÊ sugere as opções, não fica esperando: "E sobre o pagamento, você pensa em financiar, pagar à vista, ou tem um carro pra dar na troca?".
7. **Troca → pré-avaliação COMPLETA** — se topar dar um carro, puxe de forma natural (uma de cada vez) os 5 dados: modelo, ano, km, há quanto tempo é dono, e estado/nota do carro. **A cada dado, CHAME save_trade_in_evaluation.** Não pare só em km e ano — cubra os 5.
8. **Visita** — só DEPOIS de qualificar (FORD) e sondar pagamento/troca, conduza pro agendamento.

ROBUSTEZ (o cliente entra de vários jeitos):
- JÁ chega oferecendo o carro da troca → comece pela pré-avaliação, mas depois volte e cubra FORD + mostre carros.
- JÁ chega decidido num modelo → mostre o carro, mas ainda qualifique (FORD) e sonde pagamento/troca antes da visita.
- Mantenha o funil SEMPRE; só adapte a ordem. Não pule etapas porque o cliente foi direto.
- Sempre WhatsApp: mensagens curtas, UMA pergunta por vez. Nunca despeje várias perguntas juntas.

## Regra de sequência — a VISITA é sempre o ÚLTIMO passo

NUNCA ofereça agendar visita antes de ter: (a) qualificado com o FORD (pelo menos 3 das 4 dimensões), E (b) sondado a forma de pagamento de forma proativa.

- **"Quero ver / dar uma olhada / me mostra" = interesse NO CARRO, NÃO pedido de visita.** Mostre os detalhes (e foto, se houver) e EMENDE com qualificação: "Mostro sim! [detalhes]. Deixa eu te conhecer um pouco melhor pra já achar o ideal pra você — esse seria mais pra você ou pra família?".
- **Se o cliente PEDIR a visita explicitamente antes de qualificar** → acolha, mas qualifique rapidinho antes: "Com certeza, já organizo! Só deixa eu adiantar umas coisas pro gerente: [pergunta FORD]". Não recuse a visita, mas não feche sem pelo menos algumas perguntas.
- **Carro SEM FOTO** → dê os detalhes e CONTINUE qualificando. NÃO use a falta de foto como atalho pra empurrar visita. O "melhor ver pessoalmente" só DEPOIS de qualificar + sondar pagamento, na hora de fechar.
- **Pagamento PROATIVO:** você sonda sozinho, sem esperar — depois do FORD: "E sobre o pagamento, você pensa em financiar, pagar à vista, ou tem um carro pra dar na troca?".

## Limites (vendedor bom, não chato)

- Nada de pressão desonesta, falsa urgência, mentira sobre o carro ou esconder defeito.
- Se o cliente sinalizar que quer ir no ritmo dele, respeite. O objetivo é ser um vendedor bom e simpático, não insistente.`;

  return `Você é um vendedor experiente da **${company}**, uma concessionária de veículos. Você conversa com clientes pelo WhatsApp como uma pessoa de verdade.

## Informações da concessionária

- Nome: ${company}
- Endereço: ${address}
- Telefone: ${phone}
- Horário de funcionamento: ${horarios}
- Data de hoje (Brasília): ${todayLabel}${nomeInfo}

Use a data de hoje como referência sempre que o cliente falar em datas relativas ("hoje", "amanhã", "sexta que vem", "fim de semana"). Nunca ofereça nem confirme horário fora do funcionamento da loja: a agenda real — só com horários válidos e que ainda não passaram hoje — vem sempre do ver_horarios_disponiveis; ofereça apenas os horarios_livres que ela retornar.

## Seu papel

Você atende os clientes de forma cordial e eficiente, ajudando com:

- Dúvidas sobre os veículos disponíveis no estoque
- Agendamento de visitas à concessionária
- Registro do interesse do cliente

Seu objetivo é entender o que o cliente procura, mostrar as opções que a concessionária tem, e conduzi-lo a agendar uma visita.${conductionBlock}

## Nome do cliente

- **Se você ainda não souber o nome do cliente, pergunte ANTES de qualquer outra coisa.** Exemplo: "Pra começar, qual o seu nome?"
- Quando o cliente informar o nome, chame imediatamente a ferramenta \`salvar_nome_cliente\`.
- **SEMPRE chame o cliente pelo primeiro nome quando souber.** Use-o de forma natural na conversa.

## Tom e estilo de conversa

- Fale como um bom vendedor humano: cordial, prestativo, próximo, mas profissional.
- Escreva como no WhatsApp: mensagens curtas e naturais. Nada de textão corporativo.
- Emojis com moderação — no máximo um de vez em quando, não em toda mensagem.
- Não use formatação de markdown (como \`**\` ou \`##\`). Se precisar destacar algo, use o negrito do WhatsApp (\`*texto*\` com um asterisco só), com parcimônia.
- Não despeje informação. Responda o que foi perguntado e conduza a conversa com naturalidade.
- Faça uma pergunta de cada vez, como numa conversa de verdade.

## Ferramentas

A descrição de cada ferramenta já diz quando usá-la e como tratar cada retorno — siga-as à risca. Duas regras valem para todas:

- Nunca afirme um dado que deveria vir de ferramenta (veículo, preço, disponibilidade, horário livre). Sem o retorno em mãos, diga que vai confirmar em vez de supor.
- O estoque tem carros E motos — diferencie corretamente ao apresentar cada veículo.

## Quando o cliente pede um carro que você não tem exatamente

Sua missão é DUPLA: registrar o interesse E converter a venda no que VOCÊ TEM. Nunca empurre o cliente pra porta com "estoque enxuto" ou "te aviso quando entrar" — isso é o ÚLTIMO recurso, nunca o primeiro.

PROCESSO:

1. Após confirmar via consultar_estoque que o modelo exato não existe, chame registrar_interesse_veiculo com os dados que já tem (sem interrogar antes).

2. Na MESMA resposta, busque ALTERNATIVAS REAIS com consultar_estoque (mesma categoria, marca parecida, faixa de preço/ano próxima) e apresente 2-3 opções COM VALOR — nunca se desculpando por não ter o exato. Feche perguntando qual chamou mais e ofereça foto/vídeo.

3. Se o cliente DEMONSTRAR INTERESSE em alguma → chame enviar_midia_carro com o car_id correto, sonde troca/qualificação (ver seções acima) e conduza pra visita.

4. Se o cliente RECUSAR (primeira objeção): entenda o PORQUÊ e ofereça UM ângulo novo OU outra opção real, valorizando (sonde o que mais pesa: economia, espaço, visual).

5. Se RECUSAR de novo / disser um "não" claro: RESPEITE — não insista uma terceira vez. Encerre com classe, sem desvalorizar, deixando registrado e a porta aberta.

6. Se de fato não houver nada parecido: não invente e NÃO diga "estoque enxuto". Registre de forma positiva: "Anotei certinho o que você procura. Assim que entrar algo nesse perfil, você é o primeiro que eu chamo."

REGRA DE LIMPEZA: depois que o cliente aceitar uma opção ou recusar claramente, NÃO repita a oferta nas próximas mensagens. A conversa segue normal (se ele perguntar horário, responda só o horário).

## Financiamento e formas de pagamento

Quando o cliente perguntar sobre pagamento ou financiamento:
1. Informe as formas de pagamento aceitas conforme a seção "Formas de pagamento aceitas pela loja" (quando disponível) e o FAQ. Nunca invente formas que não estejam listadas.
${financingBlock}

## Regras que você NUNCA quebra

- **Nunca invente informação.** Não cite carros, preços, anos, quilometragem ou disponibilidade que não vieram da ferramenta \`consultar_estoque\`. Se não tiver a informação, diga que vai checar ("deixa eu confirmar aqui") em vez de inventar.
- **Nunca invente condições de financiamento, valor de troca, garantia ou políticas da loja.** Se o cliente perguntar e você não tiver certeza, diga que vai confirmar com o gerente em vez de inventar.
- **Antes de agendar, confirme os detalhes com o cliente** e respeite o horário de funcionamento da concessionária. Nunca agende fora do horário de funcionamento.
- **Nunca confirme um agendamento sem que a ferramenta agendar_visita retorne \`sucesso: true\`.** Se a ferramenta retornar \`sucesso: false\` ou um campo \`error\`, NUNCA diga "marquei sua visita" — diga ao cliente que vai confirmar o horário com o gerente e já retorna, então chame chamar_atendente (handoff silencioso).
- **Nunca prometa nada em nome da concessionária** que você não tenha como garantir.
- **O car_id do enviar_midia_carro DEVE ser exatamente um id retornado por um consultar_estoque chamado NESTA resposta — nunca invente, nunca use ID parcial, nunca reaproveite id "de memória" de turnos antigos (eles não existem mais no seu contexto).** Cliente pediu foto e você não tem id fresco? consultar_estoque primeiro (filtre pela marca/modelo do carro em questão). Não sabe de qual carro é a foto? Pergunte.

## Limites e segurança

- Fale apenas sobre assuntos da concessionária: veículos, visitas, atendimento. Não entre em política, religião, opiniões pessoais, concorrentes ou temas sem relação com a loja. Se o cliente puxar esses assuntos, redirecione gentilmente para como você pode ajudar com os carros.
- Se o cliente for ofensivo ou xingar: mantenha a educação, não responda à altura, e redirecione com calma para como você pode ajudar. Se a hostilidade persistir, acione a equipe nos bastidores (chamar_atendente) e diga que vai resolver isso pessoalmente.
- Se perguntarem diretamente se você é um robô/bot/IA, responda com naturalidade ("Sou parte da equipe da loja, posso te ajudar daqui — quer ver os carros que temos?") e desconverse pra venda. NUNCA minta ativamente dizendo que é humano — apenas desvie educadamente pra continuar o atendimento.
- Nunca compartilhe informações internas, dados de outros clientes, ou detalhes técnicos internos.
- Não peça nem registre dados sensíveis do cliente (CPF, dados bancários, cartão). Se for necessário para o negócio, isso é feito pessoalmente pela equipe da loja.

## Lembre-se

Você representa a ${company}. Cada conversa é uma oportunidade de ajudar alguém a encontrar o carro certo e dar o próximo passo — uma visita à loja. Seja útil, seja humano, e quando não souber de algo, peça ajuda em vez de inventar.${
    settings.bot_custom_instructions
      ? `\n\n## Instruções específicas desta concessionária (siga sempre)\n\n${settings.bot_custom_instructions}`
      : ''
  }${
    faqs.length > 0
      ? `\n\n## Perguntas frequentes — use estas respostas quando o cliente perguntar algo relacionado\n\n${faqs.map((f) => `P: ${f.question}\nR: ${f.answer}`).join('\n\n')}`
      : ''
  }${paymentBlock}${fordBlock}${tradeInBlock}${visitReminderBlock}`;
}

// ─── chamada à API do Claude ──────────────────────────────────────────────────

const CLAUDE_MODEL = 'claude-sonnet-4-6';

// Provedor de LLM: coluna do tenant (company_settings.llm_provider) > env var >
// 'anthropic'. O caminho do Claude é o default e permanece inalterado — a flag
// é um SWITCH de teste, não uma migração.
const LLM_PROVIDER_DEFAULT = (Deno.env.get('LLM_PROVIDER') ?? 'anthropic').toLowerCase();
const OPENAI_MODEL = 'gpt-5-mini';

// A família gpt-5 e a série "o" não aceitam max_tokens — usam max_completion_tokens.
// Mandar o parâmetro errado dá 400 e o turno inteiro cai no fallback.
// Nesses modelos o limite também cobre os tokens de raciocínio interno, que não
// aparecem pro cliente: com 1024 o texto podia acabar truncado ou vazio, por isso
// a folga. O gpt-4o-mini segue com max_tokens, então voltar atrás é só trocar a
// constante acima.
const OPENAI_USA_MAX_COMPLETION = /^(gpt-5|o[134])/.test(OPENAI_MODEL);
const OPENAI_LIMITE_SAIDA: Record<string, number> = OPENAI_USA_MAX_COMPLETION
  ? { max_completion_tokens: 4096 }
  : { max_tokens: 1024 };

// Prefixo aplicado SÓ quando o provedor é OpenAI. O prompt principal foi escrito
// para o Claude (prosa longa, regras espalhadas) — os modelos da OpenAI, e o mini
// em especial, obedecem muito melhor a regras curtas e imperativas no TOPO.
// Cada item aqui corresponde a uma falha observada no teste de 04/08.
const OPENAI_RULES_PREFIX = `## REGRAS OPERACIONAIS — PRIORIDADE MÁXIMA

Estas regras vêm ANTES de qualquer outra instrução deste prompt. Se algo mais
abaixo conflitar com elas, siga o que está aqui.

1. FORMATO: proibido usar ** ## ou lista numerada. O negrito do WhatsApp é *assim*.
   ERRADO: "**Ano:** 2020"  →  CERTO: "Ano 2020"
2. UMA pergunta por mensagem. Nunca duas. Se precisa de 3 informações, são 3 mensagens.
3. AGENDA: nunca escreva um dia ou horário que não tenha saído de
   ver_horarios_disponiveis NESTA resposta. Se o cliente falar em visita ou horário,
   chame a tool ANTES de responder. Proibido perguntar "hoje ou amanhã?" sem consultar.
4. Horário que ESTÁ em horarios_livres → chame agendar_visita imediatamente.
   request_schedule_check é SÓ para horário que NÃO está na lista. Nunca os dois.
5. MOSTRAR CARROS: no máximo 2 por mensagem, uma linha cada
   (ex.: "Polo 2020, 56 mil km, R$ 78.000"). Nunca liste o estoque inteiro.
6. car_id só pode vir do consultar_estoque desta resposta. Número que aparece dentro
   de link ou nome de arquivo NÃO é car_id.
7. Na pré-avaliação da troca, uma informação por vez: pergunte o modelo, espere a
   resposta, depois o ano, e assim por diante. Nunca junte km + tempo de uso + nota
   na mesma mensagem.
8. VISITA — a diferença entre VOCÊ oferecer e o CLIENTE pedir:
   (a) VOCÊ oferecer, por iniciativa própria: só depois de ter 3 respostas sobre o
       perfil do cliente + ter sondado a forma de pagamento. Antes disso não escreva
       "podemos agendar uma visita", "que tal conhecer pessoalmente".
   (b) O CLIENTE pedir ou dizer que quer ir ver: ATENDA NA HORA, sempre, com
       cortesia. Nunca recuse, nunca enrole, nunca diga que precisa perguntar mais
       coisas antes. Chame ver_horarios_disponiveis e ofereça horário de verdade:
       "Claro! Pode vir [dia] às [hora] que deixo o carro pronto pra você ver."
       Se quiser, encaixe UMA pergunta de perfil junto — mas o agendamento vem
       primeiro e não pode ficar travado por causa dela.
9. Depois de mostrar um carro ou enviar foto POR INICIATIVA SUA (o cliente não pediu
   visita), termine com uma pergunta de qualificação em vez de convite pra visita.
   ERRADO: "Se estiver interessado, podemos agendar uma visita. Que tal?"
   CERTO:  "Esse seria mais pra você no dia a dia ou pra família?"
   Isto NÃO se aplica quando o cliente já demonstrou que quer visitar — aí vale a regra 8(b).
10. Proibido "temos apenas", "só temos", "infelizmente", "estoque enxuto". Se o
    consultar_estoque voltou 1 carro porque você filtrou por modelo, chame de novo
    SEM filtro antes de responder — a loja quase sempre tem mais opções.
11. CHAMAR A TOOL É O QUE VALE — escrever que fez NÃO faz nada acontecer.
    - Cliente respondeu sobre família, filhos, profissão, uso do carro ou forma de
      pagamento? Chame save_lead_qualification NESTA MESMA resposta, antes do texto.
      Ex.: cliente diz "tenho 3 filhos, é pra família" → save_lead_qualification({ family: "casado, 3 filhos, carro pra família" }).
    - Vai escrever que fala com o gerente/superior? Então chame chamar_atendente
      NESTA MESMA resposta. Sem a tool, ninguém do outro lado é avisado e o cliente
      fica esperando pra sempre.
    - Cliente falou do carro dele (modelo, ano, km, tempo de uso, estado)? Chame
      save_trade_in_evaluation na hora, a cada dado novo.

`;

// Breakpoint de cache no fim do histórico: o prefixo da conversa é reaproveitado
// entre turnos e entre iterações do loop de tools (leitura ≈10% do preço; escrita 1,25×).
// Não muta o array original — retries e o loop reusam `messages` sem marcadores acumulados.
// Conversas curtas (< mínimo cacheável do modelo) simplesmente não cacheiam, sem erro.
function withHistoryCacheBreakpoint(
  messages: Array<{ role: 'user' | 'assistant'; content: string | unknown[] }>,
): Array<{ role: 'user' | 'assistant'; content: string | unknown[] }> {
  if (!messages.length) return messages;
  return messages.map((m, i) => {
    if (i !== messages.length - 1) return m;
    if (typeof m.content === 'string') {
      if (!m.content) return m; // bloco de texto vazio é rejeitado pela API
      return { role: m.role, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] };
    }
    if (!m.content.length) return m;
    const blocks = m.content.map((b, j, arr) =>
      j === arr.length - 1 ? { ...(b as Record<string, unknown>), cache_control: { type: 'ephemeral' } } : b
    );
    return { role: m.role, content: blocks };
  });
}

async function callClaude(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string | unknown[] }>,
  log: Logger,
  attempt = 0,
): Promise<ClaudeResponse> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  // Backoff exponencial: 2s, 5s, 10s (3 tentativas extras)
  const BACKOFF_MS = [2000, 5000, 10000];
  const MAX_RETRIES = BACKOFF_MS.length;

  // Timeout defensivo: aborta a chamada se a API do Claude travar (não responder).
  // O AbortError cai no catch abaixo e entra no fluxo normal de retry.
  const TIMEOUT_MS = 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: [
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
        ],
        messages: withHistoryCacheBreakpoint(messages),
        tools: TOOLS.map((t, i) =>
          i === TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t
        ),
      }),
      signal: controller.signal,
    });
  } catch (netErr) {
    // Erro de rede OU timeout (AbortError) → retry com backoff
    if (attempt < MAX_RETRIES) {
      const delay = BACKOFF_MS[attempt];
      const isTimeout = (netErr as Error)?.name === 'AbortError';
      log.warn('retry da chamada ao Claude', {
        action: 'claude_call',
        reason: isTimeout ? `timeout ${TIMEOUT_MS}ms` : 'erro de rede',
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        delayMs: delay,
      });
      await new Promise((r) => setTimeout(r, delay));
      return callClaude(systemPrompt, messages, log, attempt + 1);
    }
    throw netErr;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const body = await res.text();
    // Erros transitórios (rate limit 429, sobrecarga 529, server 5xx) → retry com backoff
    const retriable = [408, 409, 429, 500, 502, 503, 504, 529].includes(res.status);
    if (retriable && attempt < MAX_RETRIES) {
      const delay = BACKOFF_MS[attempt]; // 2s, 5s, 10s
      log.warn('retry da chamada ao Claude', {
        action: 'claude_call',
        status: res.status,
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        delayMs: delay,
      });
      await new Promise((r) => setTimeout(r, delay));
      return callClaude(systemPrompt, messages, log, attempt + 1);
    }
    log.error('Claude API falhou após retries', {
      action: 'claude_call',
      status: res.status,
      retries: attempt,
      body: body.slice(0, 300),
    });
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }
  const data = await res.json() as ClaudeResponse;
  const u = data.usage ?? {};
  log.info('cache/usage da chamada', {
    action: 'claude_call',
    cacheCreated: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
  });
  return data;
}

// ─── OpenAI (teste A/B por tenant) ────────────────────────────────────────────
// O formato interno do bot é SEMPRE o da Anthropic (blocos de conteúdo). As
// funções abaixo traduzem só na hora do request/response — o loop, a execução
// de tools e o acúmulo de mensagens não sabem que existe outro provedor.

// Tools: {name, description, input_schema} → {type:"function", function:{...parameters}}
function toolsToOpenAI() {
  return TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

function messagesToOpenAI(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string | unknown[] }>,
) {
  const out: Record<string, unknown>[] = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks = (m.content ?? []) as Record<string, any>[];

    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
      const uses = blocks.filter((b) => b.type === 'tool_use');
      const msg: Record<string, unknown> = { role: 'assistant', content: text || null };
      if (uses.length) {
        msg.tool_calls = uses.map((b) => ({
          id: b.id,
          type: 'function',
          // arguments é STRING JSON no OpenAI (na Anthropic é objeto)
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      }
      out.push(msg);
    } else {
      // A Anthropic manda TODOS os tool_results num lote dentro de um role:"user";
      // o OpenAI exige UMA mensagem role:"tool" por resultado. Desmembra aqui.
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: String(b.content ?? '') });
        } else if (b.type === 'text') {
          out.push({ role: 'user', content: b.text ?? '' });
        }
      }
    }
  }
  return out;
}

// Resposta do OpenAI → shape ClaudeResponse (o loop não muda)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function openAIToClaudeResponse(data: Record<string, any>): ClaudeResponse {
  const choice = data.choices?.[0] ?? {};
  const msg = choice.message ?? {};
  const content: ClaudeContentBlock[] = [];
  if (msg.content) content.push({ type: 'text', text: String(msg.content) });
  for (const tc of (msg.tool_calls ?? [])) {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { /* input fica {} */ }
    content.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input });
  }
  const STOP: Record<string, string> = {
    stop: 'end_turn', tool_calls: 'tool_use', length: 'max_tokens', content_filter: 'refusal',
  };
  const u = data.usage ?? {};
  return {
    id: String(data.id ?? ''),
    type: 'message',
    stop_reason: STOP[String(choice.finish_reason)] ?? 'end_turn',
    content,
    usage: {                                  // normalizado: llm_usage não muda
      input_tokens: u.prompt_tokens ?? 0,
      output_tokens: u.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,         // OpenAI não cobra escrita de cache
      cache_read_input_tokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    },
  };
}

async function callOpenAI(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string | unknown[] }>,
  log: Logger,
  attempt = 0,
): Promise<ClaudeResponse> {
  const apiKey = Deno.env.get('OPENAI_API_KEY') ?? '';
  const BACKOFF_MS = [2000, 5000, 10000];
  const MAX_RETRIES = BACKOFF_MS.length;
  const TIMEOUT_MS = 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        ...OPENAI_LIMITE_SAIDA,
        messages: messagesToOpenAI(systemPrompt, messages),
        tools: toolsToOpenAI(),
        tool_choice: 'auto',
        // Sem cache_control: o OpenAI cacheia automaticamente (prompts > 1024 tokens).
      }),
      signal: controller.signal,
    });
  } catch (netErr) {
    if (attempt < MAX_RETRIES) {
      const delay = BACKOFF_MS[attempt];
      const isTimeout = (netErr as Error)?.name === 'AbortError';
      log.warn('retry da chamada ao OpenAI', {
        action: 'openai_call',
        reason: isTimeout ? `timeout ${TIMEOUT_MS}ms` : 'erro de rede',
        attempt: attempt + 1, maxRetries: MAX_RETRIES, delayMs: delay,
      });
      await new Promise((r) => setTimeout(r, delay));
      return callOpenAI(systemPrompt, messages, log, attempt + 1);
    }
    throw netErr;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const body = await res.text();
    const retriable = [408, 409, 429, 500, 502, 503, 504].includes(res.status);
    if (retriable && attempt < MAX_RETRIES) {
      const delay = BACKOFF_MS[attempt];
      log.warn('retry da chamada ao OpenAI', {
        action: 'openai_call', status: res.status,
        attempt: attempt + 1, maxRetries: MAX_RETRIES, delayMs: delay,
      });
      await new Promise((r) => setTimeout(r, delay));
      return callOpenAI(systemPrompt, messages, log, attempt + 1);
    }
    log.error('OpenAI API falhou após retries', {
      action: 'openai_call', status: res.status, retries: attempt, body: body.slice(0, 300),
    });
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const raw = await res.json();
  const data = openAIToClaudeResponse(raw);
  const u = data.usage ?? {};
  log.info('cache/usage da chamada', {
    action: 'openai_call',
    cacheCreated: 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
  });
  return data;
}

// Despachante: única porta de entrada do loop.
function callLLM(
  provider: string,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string | unknown[] }>,
  log: Logger,
): Promise<ClaudeResponse> {
  return provider === 'openai'
    ? callOpenAI(systemPrompt, messages, log)
    : callClaude(systemPrompt, messages, log);   // ← caminho atual, intocado
}

// ─── serve ────────────────────────────────────────────────────────────────────

serve((req) => withRequest(req, 'process-conversation', async (base, requestId) => {
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
    base.warn('conversa não encontrada', { action: 'load_conversation', conversationId, error: convErr?.message });
    return new Response('Not Found', { status: 404 });
  }

  // Handoff: se a conversa está com humano (pending = aguardando atendente,
  // human = atendente já assumiu), o bot fica 100% MUDO até o status voltar
  // para 'bot' (atendente "Devolve ao bot" no CRM). Sem gerar nem enviar nada.
  if (conv.status === 'human' || conv.status === 'pending') {
    base.info('conversa em handoff — bot mudo', { action: 'handoff', conversationId, status: conv.status });
    return new Response('OK', { status: 200 });
  }

  const userId        = conv.user_id        as string;
  const customerPhone = conv.customer_phone as string;
  let   customerName  = conv.customer_name  as string | null;
  const log = base.child({ userId, conversationId });

  // ── 2. Verifica se é a primeira mensagem (boas-vindas) — sem debounce ─────
  const { count: botCount } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('role', 'bot');

  const isFirstMessage = (botCount ?? 0) === 0;

  // ── 3. Debounce com RESET: o cliente costuma responder em vários balões com
  //    pausas. Espera ~9s de SILÊNCIO (o timer zera a cada mensagem nova), com
  //    teto de 30s, pra juntar tudo num lote só. O lock atômico abaixo garante
  //    que só UMA invocação processe o lote. Pulado para boas-vindas.
  if (!isFirstMessage) {
    const QUIET_MS = 9000;     // silêncio necessário pra considerar que terminou de digitar
    const MAX_TOTAL_MS = 30000; // teto de segurança
    const POLL_MS = 2000;
    const startedAt = Date.now();

    const latestCustomerId = async (): Promise<string | null> => {
      const { data } = await supabase
        .from('messages').select('id')
        .eq('conversation_id', conversationId).eq('role', 'customer')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      return data?.id ?? null;
    };

    let lastMsgId = await latestCustomerId();
    let lastChangeAt = Date.now();

    while (true) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));

      // Aborta cedo se a conversa virou handoff (pending/human) durante a espera.
      const { data: fresh } = await supabase
        .from('conversations').select('status').eq('id', conversationId).maybeSingle();
      if (fresh?.status === 'human' || fresh?.status === 'pending') {
        log.info('conversa virou handoff durante o debounce — abortando', { action: 'debounce', status: fresh?.status });
        return new Response('OK', { status: 200 });
      }

      const nowId = await latestCustomerId();
      if (nowId !== lastMsgId) { lastMsgId = nowId; lastChangeAt = Date.now(); } // msg nova → reseta o timer

      const quietFor = Date.now() - lastChangeAt;
      const total    = Date.now() - startedAt;
      if (quietFor >= QUIET_MS || total >= MAX_TOTAL_MS) {
        log.info('processando lote', { action: 'debounce', silencioSeg: Math.round(quietFor / 1000), totalSeg: Math.round(total / 1000) });
        break;
      }
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
    log.warn('claim ignorado (coluna last_handled_msg_id existe?) — dedupe desativada', { action: 'claim', error: claimErr.message });
  } else if (!claimed) {
    log.info('lote já assumido por outra invocação — abortando', { action: 'claim', batchKey });
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
    const wToken      = await resolveWhatsAppToken(supabase, userId);

    const welcomeText =
      `Olá! 👋 Bem-vindo à ${companyName}.\n\nPra começar, qual o seu nome?`;

    const now = new Date().toISOString();
    await supabase.from('messages').insert({ conversation_id: conversationId, role: 'bot', content: welcomeText });
    await supabase.from('conversations').update({ last_message_at: now }).eq('id', conversationId);

    const wSent = await sendMessage(customerPhone, welcomeText, wPid || undefined, wToken, log);
    if (wSent) log.info('boas-vindas enviadas', { action: 'welcome' });
    else log.error('falha ao enviar boas-vindas', { action: 'welcome', phone: customerPhone });

    return new Response('OK', { status: 200 });
  }

  // ── 4. Carrega as N mensagens mais recentes em ordem cronológica ───────────
  //    Janela de CONTEXTO enviada ao modelo — não afeta o histórico salvo:
  //    todas as mensagens continuam no banco (tabela messages) e na tela do CRM.
  //    20 = ~10 trocas. Trade-off: menos tokens por chamada, porém conversas
  //    longas perdem o começo (nome, FORD, carro discutido no início).
  const HISTORY_LIMIT = 20;
  const { data: rawMessages } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

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

  // Provedor deste tenant: coluna (migration 032) > env var > anthropic.
  // Declarado aqui (antes do prompt) porque o prefixo de regras depende dele.
  const provider  = String(settings?.llm_provider ?? LLM_PROVIDER_DEFAULT).toLowerCase();
  const modelName = provider === 'openai' ? OPENAI_MODEL : CLAUDE_MODEL;
  log.info('provedor de LLM', { action: 'llm_provider', provider, model: modelName });

  // Estado da qualificação lido do LEAD (não do histórico). Duas funções:
  //   1. o bot para de reperguntar o que já foi respondido (a janela de contexto
  //      é de 20 mensagens e o começo da conversa sai dela);
  //   2. o modelo passa a ver, explicitamente, o que ainda falta antes da visita —
  //      muito mais eficaz que a regra em prosa, principalmente no gpt-4o-mini.
  const { data: leadRow } = await supabase
    .from('leads')
    .select('family_info, occupation, recreation_info, financial_info, trade_in_model, trade_in_year, trade_in_km')
    .eq('user_id', userId)
    .eq('phone', customerPhone)
    .maybeSingle();

  const perfil: Array<[string, unknown]> = [
    ['família',   leadRow?.family_info],
    ['ocupação',  leadRow?.occupation],
    ['uso/lazer', leadRow?.recreation_info],
    ['pagamento', leadRow?.financial_info],
  ];
  const coletados = perfil.filter(([, v]) => v);
  const faltantes = perfil.filter(([, v]) => !v).map(([k]) => k);
  const dadosTroca = [leadRow?.trade_in_model, leadRow?.trade_in_year, leadRow?.trade_in_km].filter(Boolean).length;

  const leadBlock = '\n\n## Perfil já coletado deste cliente (NÃO pergunte de novo)\n\n'
    + (coletados.length ? coletados.map(([k, v]) => `- ${k}: ${v}`).join('\n') : '- (nada coletado ainda)')
    + `\n\nAinda falta descobrir: ${faltantes.length ? faltantes.join(', ') : 'nada'}.`
    + (dadosTroca ? `\nTroca: ${dadosTroca} de 3 dados básicos já registrados.` : '')
    + '\n\nREGRA: enquanto faltarem 2 ou mais itens acima, não puxe VOCÊ o assunto '
    + 'pagamento/financiamento nem ofereça visita por iniciativa própria — continue '
    + 'descobrindo o perfil, uma pergunta por vez. A ocupação é a que mais fica '
    + 'esquecida: pergunte com jeito, encaixada no papo. Mas se o CLIENTE puxar '
    + 'pagamento ou pedir pra visitar, atenda na hora e com cortesia (visita: ofereça '
    + 'horário real do ver_horarios_disponiveis e agende). Nunca faça o cliente '
    + 'esperar pra você qualificar.';

  log.info('estado da qualificação', { action: 'build_prompt', coletados: coletados.length, faltantes, dadosTroca });

  // Prompt base (idêntico pros dois provedores) + prefixo de regras só no OpenAI.
  const systemPrompt = (provider === 'openai' ? OPENAI_RULES_PREFIX : '') + buildSystemPrompt(
    (settings ?? {}) as Record<string, unknown>,
    faqRows ?? [],
    customerName,
    log,
  ) + leadBlock;

  // ── 6. Monta histórico para o modelo ──────────────────────────────────────
  //    stripMediaUrls: tira a URL da mídia (o número do arquivo virava "car_id"
  //    na cabeça do modelo). O banco e o CRM seguem com a URL completa.
  const rawHistory = orderedMessages.map((m) => ({
    role: (m.role === 'customer' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: stripMediaUrls(String(m.content)),
  }));

  const history = mergeConsecutiveRoles(rawHistory);

  if (!history.length) {
    return new Response('OK', { status: 200 });
  }

  // ── 7. Loop de chamadas ao Claude ─────────────────────────────────────────
  const phoneNumberId = String(settings?.whatsapp_phone_number_id ?? '');
  const waToken = await resolveWhatsAppToken(supabase, userId);
  const ctx = { userId, conversationId, customerPhone, customerName, phoneNumberId, token: waToken, log };
  let finalText = '';
  const toolsUsadas = new Set<string>();  // o que o modelo REALMENTE chamou neste turno
  let lastWasTool = false;   // a iteração anterior executou uma tool?
  let retriedEmpty = false;  // já re-chamamos uma vez por resposta vazia pós-tool?

  const claudeMessages: Array<{ role: 'user' | 'assistant'; content: string | unknown[] }> = [...history];

  try {
    for (let iteration = 0; iteration < 10; iteration++) {
      const response = await callLLM(provider, systemPrompt, claudeMessages, log);

      log.info('resposta do Claude', {
        action: 'claude_loop',
        iteration,
        stopReason: response.stop_reason,
        contentTypes: response.content.map((c) => c.type),
      });
      log.debug('preview da resposta', { action: 'claude_loop', iteration, preview: response.content.slice(0, 2) });

      // Telemetria persistida: 1 linha por chamada ao Claude (custo por conversa/conta).
      // Falha aqui NUNCA bloqueia o fluxo (a tabela pode nem existir — migração 030).
      try {
        const u = response.usage ?? {};
        const { error: usageErr } = await supabase.from('llm_usage').insert({
          user_id: userId,
          conversation_id: conversationId,
          request_id: requestId,
          model: modelName,
          input_tokens: u.input_tokens ?? 0,
          output_tokens: u.output_tokens ?? 0,
          cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
        });
        if (usageErr) log.warn('falha ao gravar llm_usage', { action: 'llm_usage', error: usageErr.message });
      } catch (e) {
        log.warn('falha ao gravar llm_usage', { action: 'llm_usage', error: e });
      }

      if (response.stop_reason === 'max_tokens') {
        log.warn('resposta truncada (max_tokens)', { action: 'claude_loop', iteration });
      }

      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      const textBlocks    = response.content.filter((b) => b.type === 'text');

      if (!toolUseBlocks.length) {
        finalText = textBlocks.map((b) => b.text ?? '').join('\n').trim();
        if (finalText) break; // resposta pronta pro cliente

        // finalText VAZIO. Se foi logo após uma tool (save silencioso), o Claude
        // às vezes encerra o turno sem falar — NÃO encerra a conversa: cutuca e
        // re-chama UMA vez pra ele gerar a próxima mensagem.
        if (lastWasTool && !retriedEmpty) {
          log.warn('vazio após tool — re-chamando Claude (retry de continuação)', { action: 'claude_loop', iteration });
          const last = claudeMessages[claudeMessages.length - 1];
          if (last && last.role === 'user' && Array.isArray(last.content)) {
            last.content.push({ type: 'text', text: 'Continue a conversa com o cliente: comente brevemente e faça a PRÓXIMA pergunta (ex.: próxima dimensão do FORD) ou siga o fluxo. NUNCA encerre o turno em silêncio.' });
          }
          retriedEmpty = true;
          lastWasTool = false;
          continue;
        }
        log.error('sem texto do Claude após retry de continuação', {
          action: 'claude_loop',
          iteration,
          contentTypes: response.content.map((c) => c.type),
          content: response.content,
        });
        break;
      }

      claudeMessages.push({ role: 'assistant', content: response.content });

      const toolResults: unknown[] = [];
      for (const block of toolUseBlocks) {
        toolsUsadas.add(block.name ?? '');
        const result = await executeTool(
          block.name ?? '',
          (block.input ?? {}) as Record<string, unknown>,
          ctx,
          supabase,
        );
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }

      claudeMessages.push({ role: 'user', content: toolResults });
      lastWasTool = true;
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    log.error('erro no loop do Claude (após retries) — enviando ponte', {
      action: 'fallback',
      error: err.message,
      stack: err.stack,
    });

    // Erro transitório do modelo NÃO é motivo de handoff — manda uma ponte
    // amigável e mantém a conversa com o bot (o próximo turno do cliente reativa).
    const fallbackMsg = 'Opa, me perdi aqui rapidinho 😅 me lembra o que a gente tava vendo? Já te ajudo.';

    try {
      const fbSent = await sendMessage(customerPhone, fallbackMsg, phoneNumberId || undefined, waToken, log);
      await supabase.from('messages').insert({ conversation_id: conversationId, role: 'bot', content: fallbackMsg });
      await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId);
      if (!fbSent) log.error('falha ao enviar ponte de erro (salva no banco mesmo assim)', { action: 'fallback', phone: customerPhone });
    } catch (sendErr) {
      log.error('erro ao enviar ponte de erro', { action: 'fallback', error: sendErr });
    }

    return new Response('OK', { status: 200 });
  }

  // Resposta vazia mesmo após o retry de continuação: NÃO escala pra humano
  // (vazio após save é hiccup do modelo, não "precisa de gente"). Manda uma
  // PONTE que continua a conversa — o próximo turno do cliente reativa o bot.
  if (!finalText.trim()) {
    log.error('resposta vazia mesmo após retry — enviando ponte (sem handoff)', { action: 'fallback' });
    const bridge = 'Opa, me perdi aqui rapidinho 😅 me lembra o que a gente tava vendo? Quero te ajudar a achar o carro certo.';
    try {
      await sendMessage(customerPhone, bridge, phoneNumberId || undefined, waToken, log);
      await supabase.from('messages').insert({ conversation_id: conversationId, role: 'bot', content: bridge });
      await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId);
    } catch (e) {
      log.error('erro ao enviar ponte de resposta vazia', { action: 'fallback', error: e });
    }
    return new Response('OK', { status: 200 });
  }

  // ── 7.5. GUARDA: prometeu humano mas não chamou a tool ────────────────────
  //    O modelo às vezes ESCREVE "vou verificar com meu gerente" e não chama o
  //    chamar_atendente — a conversa fica com status 'bot', ninguém é avisado e o
  //    cliente espera por um humano que nunca soube dele. Aqui o handoff é forçado.
  //    NÃO dispara quando request_schedule_check foi usado: aquele fluxo também diz
  //    "verificar com meu superior", mas quem responde é o cron, não um humano.
  //    Dois padrões, ambos validados contra frases reais do bot:
  //    (a) "com (o/meu) gerente|superior|gerência|responsável" — o prompt só manda
  //        citar essas palavras em handoff real.
  //    (b) "<alguém|equipe|especialista|...> ... entra em contato" — foi o que
  //        escapou em 05/08: o Claude respondeu "em breve alguém da equipe entra em
  //        contato" sem chamar a tool, e a conversa ficou em 'bot'. O sujeito humano
  //        antes de "em contato" evita pegar "sou parte da equipe da loja".
  //    Falso positivo custa uma conversa em pending que o atendente devolve ao bot;
  //    falso negativo custa um cliente esperando pra sempre.
  const PROMESSA_HUMANO =
    /\bcom\s+(o\s+|a\s+|meu\s+|minha\s+)?(gerente|superior|ger[êe]ncia|respons[áa]vel)\b|(algu[ée]m|equipe|time|especialista|consultor|vendedor|atendente)[^.!?\n]{0,40}entra(r|rá|rão)?\s+em\s+contato/i;
  if (
    !toolsUsadas.has('chamar_atendente') &&
    !toolsUsadas.has('request_schedule_check') &&
    PROMESSA_HUMANO.test(finalText)
  ) {
    const { error: hoErr } = await supabase
      .from('conversations').update({ status: 'pending' }).eq('id', conversationId);
    log.warn('handoff forçado — bot prometeu falar com humano sem chamar a tool', {
      action: 'chamar_atendente', forcado: true, trecho: finalText.slice(0, 120), error: hoErr?.message,
    });
  }

  // ── 8. Envia resposta ao cliente pelo WhatsApp ─────────────────────────────
  const sent = await sendMessage(customerPhone, finalText, phoneNumberId || undefined, waToken, log);
  if (sent) {
    log.info('resposta enviada', { action: 'send_final', chars: finalText.length });
  } else {
    log.error('falha ao enviar WhatsApp — mensagem salva no banco mesmo assim', { action: 'send_final', phone: customerPhone });
  }

  // ── 9. Salva resposta do bot e atualiza last_message_at ────────────────────
  const now = new Date().toISOString();
  await supabase.from('messages').insert({ conversation_id: conversationId, role: 'bot', content: finalText });
  await supabase.from('conversations').update({ last_message_at: now }).eq('id', conversationId);

  return new Response('OK', { status: 200 });
}));
