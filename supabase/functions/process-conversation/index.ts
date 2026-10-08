import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { sendMessage, sendMessageComId, sendImage, sendVideo, resolveWhatsAppToken, sendListaInterativa, sendCatalogo } from '../_shared/whatsapp.ts';
import { enviarSocial, enviarImagemSocial } from '../_shared/social.ts';
import { maskName } from '../_shared/maskPII.ts';
import { withRequest, type Logger } from '../_shared/logger.ts';
import { botPodeResponder, COLUNAS_GUARDA } from '../_shared/botGuards.ts';

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

/**
 * Avisa o lojista no celular que uma conversa precisa de gente.
 *
 * Mensagem comum já notifica pelo whatsapp-webhook. ESTA é diferente: a
 * conversa caiu para "pendente", ou seja, o bot parou e alguém tem que entrar.
 * É o aviso que não pode ser perdido — cliente pedindo atendente e ninguém
 * respondendo é pior do que não ter bot nenhum.
 *
 * waitUntil, e não fetch solto: trabalho assíncrono pendente é cancelado quando
 * o handler responde. Foi exatamente esse detalhe que manteve o push do webhook
 * quebrado por semanas.
 */
function avisarPendente(userId: string, nome: string, motivo: string, convId: string): void {
  try {
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
          titulo: `${nome || 'Cliente'} precisa de atendimento`,
          corpo: motivo,
          url: '/conversas',
          // Tag PRÓPRIA, diferente da mensagem comum: um pedido de atendente não
          // pode ser substituído pela notificação da mensagem seguinte.
          tag: `pendente-${convId}`,
        }),
      }).catch((e) => console.warn('[pendente-push] falha:', e)),
    );
  } catch (e) {
    console.warn('[pendente-push] erro inesperado:', e);
  }
}

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

/**
 * Nota de horario pro modelo, entregue como ULTIMA mensagem (nunca no system
 * prompt).
 *
 * O system prompt so tem a DATA, de proposito: hora muda a cada minuto e
 * invalidaria o prompt caching. A suposicao era que computeFreeSlots cobria o
 * resto server-side — mas ele so roda quando o modelo CHAMA a tool. Quando o
 * bot escreve "quer vir hoje ou amanha?" em texto livre, as 20h, nada valida, e
 * ele oferece um dia que ja acabou.
 *
 * Aqui a hora entra pelo array de mensagens, DEPOIS dos cache breakpoints do
 * system prompt e das tools, entao o cache continua valendo.
 */
function notaDeHorario(settings: Record<string, unknown> | null): string {
  const agora = new Date();
  const hhmm = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(agora);

  const DIAS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const diaCurto = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short',
  }).format(agora).toLowerCase().slice(0, 3);
  const dayKey = DIAS.includes(diaCurto) ? diaCurto : 'mon';

  type DayHours = { open?: boolean; start?: string; end?: string };
  const bh = (settings?.business_hours ?? null) as Record<string, DayHours> | null;
  const hoje = bh?.[dayKey];

  const base = `(sistema: agora sao ${hhmm} no horario de Brasilia.`;

  if (bh && !hoje?.open) {
    return `${base} A loja NAO abre hoje. Nao ofereca visita para hoje; ofereca o proximo dia em que a loja abre. Confirme os horarios com a tool antes de sugerir.)`;
  }

  const abre  = String(hoje?.start ?? settings?.business_hours_start ?? '09:00');
  const fecha = String(hoje?.end   ?? settings?.business_hours_end   ?? '18:00');

  if (hhmm >= fecha) {
    return `${base} A loja fechou as ${fecha}. NAO ofereca visita para hoje — hoje ja acabou. O mais cedo possivel e amanha.)`;
  }
  if (hhmm < abre) {
    return `${base} A loja abre as ${abre} e fecha as ${fecha}. Hoje ainda e possivel, mas so a partir das ${abre}.)`;
  }
  return `${base} A loja fecha as ${fecha}. Se oferecer hoje, so horario depois de ${hhmm} e antes de ${fecha}.)`;
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
      'Calcula ESTIMATIVAS de parcela (Tabela Price) com a config da loja. Devolve DOIS OU TRÊS cenários de uma vez: sem entrada, com a entrada padrão da loja e, se o cliente informou alguma, com a dele. Apresente TODOS juntos, em texto corrido, dizendo qual é qual — a comparação é o que ajuda o cliente a decidir. Sempre como estimativa, com o disclaimer, e convidando a simular na loja porque depende de aprovação de crédito.',
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
    name: 'avaliar_troca',
    description:
      'Estima quanto a loja pagaria no carro que o cliente quer dar na troca, a partir da TABELA FIPE e da nota que o PRÓPRIO DONO deu ao carro. '
      + 'SEQUÊNCIA: colete antes os dados do carro (modelo, ano, km, tempo de posse) e principalmente a NOTA de 0 a 10; só então pergunte quanto está na FIPE hoje. '
      + 'Perguntar a FIPE antes de conversar sobre o estado do carro faz a pessoa achar que o valor já está definido. '
      + 'Você NÃO consulta a FIPE: quem informa é o cliente. Se ele não souber, peça pra ele olhar e diga que sem isso não dá pra estimar. '
      + 'Apresente SEMPRE como estimativa e deixe claro que o valor real sai na avaliação presencial, porque depende de ver o carro. '
      + 'Se vier disponivel:false, a loja não usa essa base de cálculo — NÃO invente valor nem percentual, colete os dados e siga.',
    input_schema: {
      type: 'object',
      properties: {
        valor_fipe: { type: 'number', description: 'Valor da tabela FIPE do carro do cliente, informado por ele' },
        nota:       { type: 'number', description: 'Nota de 0 a 10 que o próprio dono deu ao estado do carro' },
      },
      required: ['valor_fipe', 'nota'],
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
    .replace(/^\[v[íi]deo\]\s*https?:\/\/\S+/i, '[vídeo enviado ao cliente]')
    // Foto que o CLIENTE mandou: no histórico vira texto. Só a mais recente
    // segue como imagem de verdade (ver a injeção antes do loop) — mandar
    // todas em toda chamada multiplicaria o custo por conversa.
    .replace(/^\[imagem\]\s*https?:\/\/\S+/i, '[imagem enviada pelo cliente]');
}

/**
 * Variantes de pontuação de um nome de modelo, pra busca tolerante.
 *
 * O cliente escreve "t-cross", a loja cadastrou "T Cross", e o ilike literal
 * não casa — o bot então afirma que a loja não tem o carro. Acontece com
 * qualquer nome composto: T-Cross, HR-V, CR-V, Corolla Cross.
 * Vírgula e parênteses saem porque quebrariam a sintaxe do .or() do PostgREST.
 */
function variantesDeModelo(termo: string): string[] {
  const limpo   = termo.replace(/[,()]/g, ' ').trim();
  const espacos = limpo.replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();
  const colado  = espacos.replace(/\s+/g, '');
  const hifen   = espacos.replace(/\s+/g, '-');
  return [...new Set([limpo, espacos, colado, hifen])].filter(Boolean);
}

// Fecha o histórico quando ele termina em mensagem do bot (ver o uso, na
// montagem do histórico). NÃO é fala do cliente: as travas de resgate precisam
// ignorá-la, senão passam a testar este texto em vez do que a pessoa escreveu.
const NOTA_FECHAMENTO =
  '(sistema: as mensagens acima já foram enviadas por você ao cliente depois da última fala dele. Continue o atendimento a partir do que o cliente disse por último, sem reenviar mídia nem repetir o que já foi dito.)';

/** Normaliza pra comparar sentido, não forma: sem acento, emoji ou pontuação. */
function textoCru(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Frases "de conteúdo" de uma mensagem, normalizadas. Curtas ficam de fora. */
function frasesDe(texto: string): string[] {
  return texto
    .split(/[.!?\n]+/)
    .map(textoCru)
    .filter((f) => f.length >= 35);
}

/**
 * O bot já disse isso nesta conversa?
 *
 * O modelo repete quando o cliente responde algo que ele não sabe encaixar —
 * o Uanderson disse "só preciso confirmar o horário" e recebeu de novo "Fica
 * melhor de manhã às 9h ou de tarde às 14h?". Pedir no prompt pra não repetir
 * não segura isso.
 *
 * Compara FRASE a frase, e não a mensagem inteira: ele varia a abertura ("Tá
 * bem aberto amanhã" → "Tá cheio de horário disponível") e repete a pergunta.
 * Medindo a mensagem toda, esse caso real dá 0,62 de similaridade e escapa.
 *
 * Frase curta fica de fora: repetir "Perfeito!" ou "Qualquer coisa me chama" é
 * conversa normal. E falso positivo custa barato — só uma re-chamada ao modelo
 * pedindo pra reescrever, não uma mensagem bloqueada.
 */
function ehRepeticao(texto: string, anteriores: string[]): boolean {
  const novas = frasesDe(texto);
  if (!novas.length) return false;

  const ditas = new Set(anteriores.flatMap(frasesDe));
  if (novas.some((f) => ditas.has(f))) return true;

  // Rede secundária: mensagem inteira quase igual, sem frase idêntica.
  const alvo = textoCru(texto);
  if (alvo.length < 40) return false;
  const palavras = new Set(alvo.split(' '));
  for (const anterior of anteriores) {
    const outro = textoCru(anterior);
    if (outro.length < 40) continue;
    const set = new Set(outro.split(' '));
    let comuns = 0;
    for (const p of palavras) if (set.has(p)) comuns++;
    const uniao = new Set([...palavras, ...set]).size;
    if (uniao > 0 && comuns / uniao >= 0.8) return true;
  }
  return false;
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
  ctx: {
    userId: string; conversationId: string; customerPhone: string;
    customerName: string | null; phoneNumberId: string; token: string; log: Logger;
    // Canal de origem. Nos sociais o envio muda de endpoint e de token, e
    // customerPhone guarda o PSID/IGSID em vez de um telefone.
    canal?: string; contaId?: string; tokenSocial?: string;
  },
  supabase: SupabaseClient,
): Promise<unknown> {
  const { userId, conversationId, customerPhone, customerName, phoneNumberId, token, log } = ctx;
  const ctxCanal       = ctx.canal ?? 'whatsapp';
  const ctxContaId     = ctx.contaId ?? '';
  const ctxTokenSocial = ctx.tokenSocial ?? '';

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
      if (input.modelo) {
        // "T-Cross", "T Cross" e "TCross" são o mesmo carro pro cliente, mas o
        // ilike é literal: bastava a loja ter cadastrado com espaço em vez de
        // hífen pro bot dizer que não tinha. Casa com qualquer variante.
        // Busca em `version` também, e não só em `model`.
        //
        // O cliente pede pelo nome que a lataria tem: "GTX", "Highline",
        // "Sport". Isso quase nunca está em `model` — está em `version`. Sem
        // olhar essa coluna, "GTX" não achava o Vectra GT-X e o bot dizia que
        // a loja não tinha um carro que estava no pátio.
        const vs = variantesDeModelo(String(input.modelo));
        q = q.or(vs.flatMap((v) => [`model.ilike.%${v}%`, `version.ilike.%${v}%`]).join(','));
      }
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
    // Zero resultado num filtro NÃO prova que a loja não tem o carro: o nome
    // pode estar cadastrado de outro jeito, ou o cliente escreveu errado
    // ("t-croos"). Antes daqui isso virava "não temos em estoque" e a venda
    // morria — aconteceu com uma T-Cross que ESTAVA no pátio. Em vez de negar,
    // devolve o catálogo pro modelo conferir e perguntar.
    if (!data?.length) {
      // A VERSÃO entra aqui, e é o que faz este resgate funcionar.
      //
      // Sem ela o catálogo era só marca + modelo, e o bot recebia "Chevrolet
      // Vectra" pra decidir se tinha algo parecido com "GTX". Não tinha como:
      // a palavra que o cliente usou não existia em nada que ele podia ver, e
      // ele respondeu que a loja não tinha — com o carro no pátio.
      // O cliente chama o carro pela versão ("GTX", "Highline", "Sport") muito
      // mais do que pelo modelo.
      const { data: emEstoque } = await supabase
        .from('cars')
        .select('brand, model, version')
        .eq('user_id', userId)
        .in('status', ['available', 'reserved'])
        .order('brand', { ascending: true });

      const catalogo = [...new Set(
        (emEstoque ?? []).map((c: { brand: string | null; model: string | null; version: string | null }) =>
          [c.brand, c.model, c.version].filter(Boolean).join(' ').trim(),
        ).filter(Boolean),
      )];

      log.warn('filtro sem correspondência — devolvendo catálogo', {
        action: 'consultar_estoque', filtros: input, modelosEmEstoque: catalogo.length,
      });

      return {
        modo: 'sem_correspondencia',
        veiculos_em_estoque: catalogo,
        mensagem: 'Nenhum veículo bateu com esse filtro EXATO — mas isso NÃO significa que a loja não tem. O nome pode estar cadastrado de outra forma ("T Cross" em vez de "T-Cross") ou o cliente pode ter escrito com erro. NUNCA diga que não temos sem antes conferir a lista "veiculos_em_estoque" acima. Se achar algo parecido com o que ele pediu, confirme ("você quis dizer X?") e chame consultar_estoque de novo usando o nome exatamente como está na lista. Só diga que não temos se realmente não houver nada parecido — e aí sim registre o interesse.',
      };
    }

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

    // ── A VITRINE ────────────────────────────────────────────────────────────
    //
    // Antes daqui o bot escrevia os carros um embaixo do outro. Com quatro ou
    // cinco vira textao, e foi essa a reclamacao: "esta ficando feio".
    //
    // Agora, quando a loja tem a lista ligada, o estoque sai como MENU nativo do
    // WhatsApp — um botao que abre uma lista rolavel, com titulo e descricao por
    // carro, onde o cliente TOCA em vez de digitar. A resposta dele chega como
    // `list_reply`, que o parseInboundMessage ja le como texto.
    //
    // Tres condicoes, e cada uma tem motivo:
    //
    //   canal whatsapp  — Instagram e Messenger nao tem esse recurso
    //   2 ou mais       — menu com um item so e pior que uma frase
    //   ate 10          — limite da Meta; com 11 ela recusa a mensagem INTEIRA
    //
    // Se o envio falhar, nada e perdido: a instrucao abaixo volta a mandar o
    // modelo escrever a lista em texto, como sempre fez.
    let listaEnviada = false;
    if (ctxCanal === 'whatsapp' && data.length >= 2) {
      const { data: vitrine } = await supabase
        .from('company_settings')
        .select('lista_interativa, catalogo_habilitado')
        .eq('user_id', userId)
        .maybeSingle();

      // ── O menu NAO se repete ────────────────────────────────────────────
      //
      // Caso real de 21/09: o cliente disse "nao da pra ver todos" e o bot
      // respondeu, duas vezes, que os carros "estao no menu ali em cima".
      // Quem le isso entende "vira-se".
      //
      // Cliente que pergunta de novo depois de receber um menu esta com
      // DIFICULDADE — mandar outro menu e insistir no que nao funcionou. A
      // partir da segunda vez a resposta sai em texto, escrita.
      //
      // 15 minutos porque e a duracao tipica de uma conversa de atendimento:
      // depois disso, um menu novo e util de novo em vez de repetitivo.
      const { data: conv } = await supabase
        .from('conversations')
        .select('menu_enviado_em')
        .eq('id', conversationId)
        .maybeSingle();

      const menuRecente = Boolean(
        conv?.menu_enviado_em &&
        Date.now() - new Date(conv.menu_enviado_em as string).getTime() < 15 * 60_000,
      );

      // ── UMA vitrine por resposta, nunca as duas ──────────────────────────
      //
      // A primeira versao mandava o menu E o catalogo quando os dois estavam
      // ligados: duas mensagens seguidas com a mesma funcao. Alem de feio, e
      // confuso — o cliente nao sabe em qual tocar.
      //
      // Quem decide qual vai nao e uma preferencia, e o que o cliente PERGUNTOU:
      //
      //   "me mostra o que voces tem"  (sem filtro) -> CATALOGO, que e vitrine
      //                                               e mostra tudo
      //   "quero um Gol ate 40 mil"    (com filtro) -> MENU, com exatamente os
      //                                               carros que batem
      //
      // O catalogo NAO sabe filtrar: ele mostra o catalogo inteiro. Mandar ele
      // pra quem ja disse o que procura seria jogar 22 carros na cara de quem
      // pediu um. Por isso o menu ganha sempre que houve filtro, mesmo com o
      // catalogo ligado.
      // Fica fora do bloco de envio pra virar mensagem na tela depois.
      let linhasDoMenu: Array<{ id: string; titulo: string; descricao: string }> = [];

      const usarCatalogo = vitrine?.catalogo_habilitado === true && !temFiltro && !menuRecente;

      if (usarCatalogo) {
        // Vitrine completa, pra pergunta aberta.
        listaEnviada = await sendCatalogo(
          customerPhone,
          'Aqui esta nosso estoque completo, com foto e preco:',
          phoneNumberId, token, log,
        );
      }

      if (!usarCatalogo && !menuRecente && vitrine?.lista_interativa !== false) {
        linhasDoMenu = (data as CarListRow[]).slice(0, 10).map((c) => {
          const nome = [c.brand, c.model].filter(Boolean).join(' ').trim() || 'Veiculo';
          const preco = c.price ? `R$ ${Number(c.price).toLocaleString('pt-BR')}` : 'consulte';
          const km = c.mileage != null ? `${Number(c.mileage).toLocaleString('pt-BR')} km` : '';
          return {
            id: String(c.id),
            titulo: nome,
            // Ano, km e preco na descricao: e o que decide se a pessoa abre ou
            // nao. O titulo sozinho ("HONDA CIVIC") nao diferencia dois do
            // mesmo modelo no patio.
            descricao: [c.year, km, preco].filter(Boolean).join(' · '),
          };
        });

        listaEnviada = await sendListaInterativa(
          customerPhone,
          totalReal > linhasDoMenu.length
            ? `Separei ${linhasDoMenu.length} de ${totalReal} opcoes. Toque para ver:`
            : `Separei ${linhasDoMenu.length} opcoes pra voce. Toque para ver:`,
          'Ver veiculos',
          [{ titulo: 'Disponiveis', linhas: linhasDoMenu }],
          phoneNumberId,
          token,
          log,
        );
      }

      // Registra o envio DEPOIS de dar certo: menu que falhou nao pode calar o
      // proximo, senao um erro de rede deixaria a conversa sem vitrine nenhuma.
      if (listaEnviada) {
        await supabase.from('conversations')
          .update({ menu_enviado_em: new Date().toISOString() })
          .eq('id', conversationId);

        // ── O menu precisa APARECER na tela de Conversas ──────────────────
        //
        // Ele vai direto do servidor pra Meta e nunca passou por `messages`.
        // Resultado: o atendente lia o bot dizendo "abre o menu ali" e nao via
        // menu nenhum — parecia que o bot mandou o cliente olhar o nada.
        //
        // Pior que feio: quem assume a conversa precisa saber EXATAMENTE o que
        // o cliente recebeu. Sem isso repete carro que ja foi mostrado, ou
        // deixa de fora o que nao foi.
        //
        // Grava como texto com os mesmos itens. Nao e a mensagem literal que o
        // cliente ve — e o conteudo dela, que e o que importa pra quem atende.
        const resumoMenu = linhasDoMenu.length
          ? 'Menu de veiculos enviado ao cliente:\n' + linhasDoMenu
              .map((l) => '- ' + l.titulo + (l.descricao ? ' — ' + l.descricao : ''))
              .join('\n')
          : 'Menu de veiculos enviado ao cliente.';

        await supabase.from('messages').insert({
          conversation_id: conversationId,
          role: 'bot',
          content: resumoMenu,
          wa_status: 'sent',
        });
      }

    }

    return {
      // total = o que a loja REALMENTE tem nesse filtro; exibindo = o que veio aqui.
      total: totalReal,
      exibindo: data.length,
      ...(listaEnviada ? { lista_ja_enviada: true } : {}),
      ...(totalReal > data.length
        ? { aviso: `A loja tem ${totalReal} veículos nesse critério; estes são os ${data.length} mais baratos. Ao falar o número, use ${totalReal} — e ofereça filtrar (marca, faixa de preço, ano) pra mostrar os outros.` }
        : {}),
      // O cliente já disse o que queria (faixa, marca, ano): esconder parte da
      // lista faz ele achar que a loja tem menos do que tem. Antes o modelo
      // escolhia "destaques" por conta e mostrava 3 de 7.
      instrucao: listaEnviada
        // O menu JA foi entregue ao cliente. Repetir os mesmos carros em texto
        // logo abaixo seria a mesma lista duas vezes na tela — pior do que
        // antes de existir menu.
        ? `Os ${data.length} veículos JÁ foram enviados ao cliente como um menu interativo, que ele pode tocar. Nesta resposta, escreva só uma frase curta convidando a abrir o menu — não repita os modelos um a um.

REGRA QUE VALE MAIS QUE A DE CIMA: se o cliente disser que não está vendo, que não consegue abrir, que não apareceu, ou se ele perguntar DE NOVO pelos carros, então ESCREVA A LISTA EM TEXTO na hora, com modelo, ano e preço, e peça desculpa pela dificuldade. NUNCA responda mandando ele "olhar o menu" uma segunda vez — isso soa como "vira-se" e é exatamente o que não pode acontecer.`
        : `Liste TODOS os ${data.length} veículos acima, sem escolher destaques e sem omitir nenhum — o cliente pediu esta faixa e tem direito de ver tudo que cabe nela. Uma linha por carro, curta: modelo, ano, preço e 1 ou 2 diferenciais. Só depois pergunte qual chamou a atenção.`,
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
    // ── Já existe visita desta pessoa? ────────────────────────────────────
    //
    // Antes daqui era INSERT puro, e a agenda enchia de visita duplicada da
    // mesma pessoa. Basta o modelo chamar a ferramenta duas vezes — o cliente
    // reconfirma ("pode ser 15h então"), ou pede pra trocar o horário — pra
    // nascerem dois registros. Quem paga é o vendedor, que vê a agenda cheia
    // de compromisso que não existe e não sabe qual é o bom.
    //
    // Regra: mesma pessoa, MESMO DIA, é sempre a mesma visita.
    //   igual        → devolve a que existe, sem inserir (idempotente)
    //   horário novo → REMARCA a existente, não cria outra
    //   outro dia    → deixa criar; pode ser visita legítima pra outro carro
    const { data: jaExiste } = await supabase
      .from('appointments')
      .select('id, appointment_date, appointment_time, car_id')
      .eq('user_id', userId)
      .eq('customer_phone', customerPhone)
      .eq('appointment_date', dateStr)
      .in('status', ['scheduled', 'confirmed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (jaExiste) {
      const mesmoHorario = String(jaExiste.appointment_time ?? '').slice(0, 5) === horarioHm;

      if (mesmoHorario) {
        log.info('visita já existia — devolvendo a mesma', { action: 'agendar_visita', apptId: jaExiste.id });
        return {
          sucesso: true, id: jaExiste.id, data: dateStr, horario, status: appointmentStatus,
          ja_existia: true,
          mensagem: `Essa visita já estava agendada para ${dateStr} às ${horario}. NÃO diga que agendou de novo — confirme que está de pé e siga a conversa.`,
        };
      }

      const { data: remarcada, error: erroUp } = await supabase
        .from('appointments')
        .update({ appointment_time: horario, status: appointmentStatus, car_id: carId ?? jaExiste.car_id })
        .eq('id', jaExiste.id)
        .select()
        .single();

      if (!erroUp && remarcada) {
        log.info('visita remarcada em vez de duplicada', {
          action: 'agendar_visita', apptId: jaExiste.id,
          de: jaExiste.appointment_time, para: horario,
        });
        return {
          sucesso: true, id: remarcada.id, data: dateStr, horario, status: appointmentStatus,
          remarcada: true,
          mensagem: `Visita remarcada para ${dateStr} às ${horario}. Era ${String(jaExiste.appointment_time).slice(0, 5)}. Confirme o horário novo com o cliente.`,
        };
      }
      log.warn('falha ao remarcar — seguindo para insert', { action: 'agendar_visita', error: erroUp?.message });
    }

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

    // TRÊS cenários, sempre juntos.
    //
    // Antes a simulação devolvia um número só e recusava tudo abaixo da entrada
    // mínima — ou seja, quem perguntava "dá pra financiar tudo?" ouvia um não
    // seco e ia embora. Só que financiar 100% existe: depende do banco e do
    // perfil, e quem decide isso é a análise de crédito, não o nosso cálculo.
    //
    // Mostrar sem entrada E com entrada lado a lado faz duas coisas ao mesmo
    // tempo: responde o que a pessoa perguntou e deixa visível o quanto a
    // entrada derruba a parcela. É o argumento do vendedor, feito por conta.
    const pctComEntrada = minPct > 0 ? minPct : 20;

    const monta = (rotulo: string, entrada: number, nota: string) => {
      const financiado = Math.max(0, carPrice - entrada);
      return {
        rotulo,
        entrada: Math.round(entrada),
        entrada_percent: carPrice > 0 ? Math.round((entrada / carPrice) * 100) : 0,
        valor_financiado: Math.round(financiado),
        parcelas: n,
        valor_parcela: Math.round(calcParcelaPrice(financiado, taxa, n) * 100) / 100,
        nota,
      };
    };

    const cenarios = [
      monta('Sem entrada', 0, 'Financiando o valor total. Nem todo banco aceita, e depende da análise de crédito.'),
      monta(`Com ${pctComEntrada}% de entrada`, carPrice * (pctComEntrada / 100), 'Entrada derruba a parcela e amplia as opções de banco.'),
    ];

    // O cenário da entrada que o CLIENTE informou só entra se ele informou
    // alguma e ela for diferente das outras duas — repetir o mesmo número com
    // outro rótulo confunde em vez de ajudar.
    if (entradaTotal > 0 && Math.abs(entradaTotal - carPrice * (pctComEntrada / 100)) > 1) {
      cenarios.push(monta(
        tradeIn > 0 ? 'Com a sua entrada + troca' : 'Com a entrada que você falou',
        entradaTotal,
        'Considera o que você informou' + (tradeIn > 0 ? ', somando a avaliação estimada da troca.' : '.'),
      ));
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
      cenarios,
      taxa_mes: taxa,
      // Mantidos para não quebrar nada que já lia estes campos.
      valor_financiado: Math.round(valorFinanciado),
      parcelas: n,
      valor_parcela: Math.round(parcela * 100) / 100,
      disclaimer: 'Estimativa. O valor exato depende da análise de crédito do banco e do perfil do cliente.',
      mensagem: 'Apresente os cenários JUNTOS, em texto corrido e curto, dizendo qual é sem entrada e qual é com entrada. '
        + 'Explique numa frase que alguns bancos pedem entrada. '
        + 'Feche convidando pra simular na loja, porque depende de aprovação de crédito. '
        + 'NUNCA diga que é o valor final e NUNCA monte tabela nem lista com marcadores.',
    };
  }

  if (name === 'avaliar_troca') {
    const fipe = Number(input.valor_fipe ?? 0);
    const nota = Number(input.nota ?? -1);

    const { data: cfg } = await supabase
      .from('company_settings')
      .select('trade_in_valuation_enabled, trade_in_valuation_max_percent')
      .eq('user_id', userId).single();

    // Desligada: a loja usa outra base de cálculo, ou não quer número nenhum
    // antes de ver o carro. Nesse caso o bot NÃO improvisa.
    if (!cfg || cfg.trade_in_valuation_enabled !== true) {
      return {
        disponivel: false,
        mensagem: 'A loja não usa estimativa automática de troca. NÃO dê valor nem percentual. '
          + 'Diga que a avaliação é feita pessoalmente, porque depende de ver o carro, e convide pra levar na loja.',
      };
    }

    if (!fipe || fipe <= 0) {
      return { sucesso: false, mensagem: 'Preciso do valor da FIPE. Peça pro cliente consultar e informar.' };
    }
    if (!(nota >= 0 && nota <= 10)) {
      return { sucesso: false, mensagem: 'Preciso da nota de 0 a 10 que o dono dá ao carro. Pergunte antes de estimar.' };
    }

    // Nota 7 = 70% da FIPE. É a conta que o lojista faz de cabeça.
    //
    // Com teto: pela regra pura, nota 10 daria 100% da FIPE — valor que loja
    // nenhuma paga, e o bot prometendo isso vira discussão no balcão com o
    // cliente com razão na mão.
    const teto = Number(cfg.trade_in_valuation_max_percent ?? 90);
    const percentual = Math.min(nota * 10, teto);
    const estimado = Math.round(fipe * (percentual / 100));

    log.info('troca avaliada', { action: 'avaliar_troca', fipe, nota, percentual, estimado });

    try {
      const { data: lead } = await supabase.from('leads')
        .select('id, trade_in_extra_info').eq('user_id', userId).eq('phone', customerPhone).maybeSingle();
      if (lead) {
        const resumo = `Avaliação estimada: FIPE R$ ${fipe.toLocaleString('pt-BR')} x nota ${nota} = ${percentual}% = R$ ${estimado.toLocaleString('pt-BR')}`;
        const novo = lead.trade_in_extra_info ? `${lead.trade_in_extra_info}\n${resumo}` : resumo;
        await supabase.from('leads').update({ trade_in_extra_info: novo, updated_at: new Date().toISOString() }).eq('id', lead.id);
      }
    } catch (e) { log.error('erro ao salvar avaliação no lead', { action: 'avaliar_troca', error: e }); }

    return {
      sucesso: true,
      valor_fipe: fipe,
      nota,
      percentual,
      valor_estimado: estimado,
      teto_aplicado: nota * 10 > teto,
      mensagem: 'Diga o valor estimado explicando a conta em UMA frase (a nota que ele mesmo deu aplicada sobre a FIPE). '
        + 'Deixe claro que é estimativa e que o valor real sai vendo o carro na loja. '
        + 'Se ele já escolheu um veículo, use este valor como entrada em simular_financiamento.',
    };
  }

  if (name === 'chamar_atendente') {
    await supabase
      .from('conversations')
      .update({ status: 'pending' })
      .eq('id', conversationId);

    // O cliente PEDIU uma pessoa. Sem este aviso ele fica esperando alguem que
    // nao sabe que foi chamado — o pior desfecho possivel pro bot.
    avisarPendente(userId, customerName ?? '', 'Pediu para falar com um atendente.', conversationId);

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

    // 3b. Nada de reenviar o que o cliente já recebeu. O modelo chama esta tool
    //     por conta própria em mensagem que não pede foto ("não ficou, gostei")
    //     e o cliente leva a galeria inteira duas vezes. Pedir isso na descrição
    //     da tool não segurou — a trava tem que ser aqui.
    //     Filtro é por URL, não por carro: foto que a loja cadastrar depois é
    //     URL nova e continua saindo normalmente.
    const chaves = paraEnviar.map((u) => `[foto] ${u}`);
    if (videoUrl) chaves.push(`[vídeo] ${videoUrl}`);
    const { data: jaMandadas } = await supabase
      .from('messages')
      .select('content')
      .eq('conversation_id', conversationId)
      .in('content', chaves);
    const jaEnviado  = new Set((jaMandadas ?? []).map((m: { content: string }) => String(m.content)));
    const fotosNovas = paraEnviar.filter((u) => !jaEnviado.has(`[foto] ${u}`));
    const mandarVideo = Boolean(videoUrl) && !jaEnviado.has(`[vídeo] ${videoUrl}`);

    if (!fotosNovas.length && !mandarVideo) {
      log.info('mídia já enviada nesta conversa — reenvio bloqueado', {
        action: 'enviar_midia_carro', carId: resolvedCarId, fotos: paraEnviar.length,
      });
      return {
        success: true,
        ja_enviadas: true,
        message: `A mídia do ${carName} JÁ foi enviada nesta conversa e não foi mandada de novo — o cliente só precisa rolar a conversa pra cima. NÃO diga que está enviando. Siga o papo normalmente a partir do que ele acabou de falar.`,
      };
    }

    const sentItems: string[] = [];
    const pid = phoneNumberId || undefined;
    let fotosEnviadas = 0;

    // 4. Fotos, uma a uma e em ordem
    for (const url of fotosNovas) {
      try {
        // Instagram e Messenger usam outro endpoint e o token da pagina. Sem
        // este desvio a foto seria mandada pro Graph do WhatsApp com um PSID
        // no lugar do telefone: falharia calado e o cliente ficaria sem a foto
        // depois de o bot dizer que ia mandar.
        let ok: boolean;
        let midFoto: string | null = null;
        if (ctxCanal === 'whatsapp') {
          ok = await sendImage(customerPhone, url, pid, token, log);
        } else {
          const r = await enviarImagemSocial(ctxContaId, customerPhone, url, ctxTokenSocial, ctxCanal as 'instagram' | 'messenger');
          ok = r.ok;
          // Guarda o id: o eco de cada foto volta e, sem reconhecer, marca a
          // conversa como humana — o bot se entregava sozinho ao mandar galeria.
          midFoto = r.mid ?? null;
          if (!r.ok) log.error('falha ao enviar foto no canal social', { action: 'enviar_midia_carro', erro: r.erro });
        }
        if (ok) {
          fotosEnviadas++;
          await supabase.from('messages').insert({
            conversation_id: conversationId, role: 'bot', content: `[foto] ${url}`,
            ...(midFoto ? { wa_message_id: midFoto } : {}),
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
      if (mandarVideo) await new Promise((r) => setTimeout(r, 800)); // separa das fotos
    }

    // 5. Vídeo depois
    if (mandarVideo && videoUrl) {
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

function buildSystemPrompt(settings: Record<string, unknown>, faqs: Faq[], customerName: string | null, log: Logger, canal = 'whatsapp', falouDePagamento = true, primeiroContato = false): string {
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
  // O nome JA e conhecido: proibir perguntar de novo e o ponto principal.
  //
  // Caso real de 21/09: o bot escreveu "Luciane, qual e o seu nome pra eu
  // deixar anotado aqui?" — chamou a cliente pelo nome e pediu o nome na
  // mesma frase. Saber o nome sem ter regra contra perguntar nao bastava: o
  // modelo tem instrucao de registrar lead e cumpriu essa, sem notar a
  // contradicao.
  const nomeInfo = nomeCliente
    ? `\n- Nome do cliente nesta conversa: ${nomeCliente} (use com parcimônia, não a cada mensagem)`
      + `\n- VOCÊ JÁ SABE O NOME DELE. NUNCA pergunte "qual é o seu nome" nem peça o nome de novo, em hipótese nenhuma — nem para registrar interesse, nem para anotar, nem para agendar. Use ${nomeCliente} direto.`
    : '';

  // Sem esta nota o modelo responde a primeira mensagem sem dizer de onde fala.
  // A boas-vindas enlatada so dispara agora quando a abertura e um "oi" seco;
  // quando o cliente ja abre perguntando, quem cumprimenta é ele.
  // Toque no menu chega como TEXTO com o nome do carro.
  //
  // Caso real de 21/09: a cliente tocou em "HYUNDAI TUCSON GLSB" e o bot
  // respondeu perguntando o nome dela — ignorou o carro que ela acabara de
  // escolher. Do lado dela, ela apontou para um veiculo e foi ignorada.
  const toqueNoMenuInfo =
    '\n- Se a mensagem do cliente for SÓ o nome de um veículo (ex.: "HYUNDAI TUCSON GLSB"), ele TOCOU nesse carro no menu que você enviou. Trate como interesse declarado naquele veículo: busque no estoque e responda com os detalhes e as fotos dele IMEDIATAMENTE. Não pergunte outra coisa antes, não mude de assunto e não peça dados.';

  const primeiroContatoInfo = primeiroContato
    ? '\n- Esta é a PRIMEIRA mensagem desta conversa: cumprimente e diga de qual loja você fala, em uma linha curta, ANTES de responder o que foi perguntado.'
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
  const fordKeys = (['family', 'occupation', 'recreation', 'financial'] as const)
    .filter((k) => (ford ? ford[k] === true : true))
    // Nos canais sociais, a pergunta de pagamento SÓ entra depois que o cliente
    // tocar no assunto. Pedir "não fale de financiamento" numa nota solta não
    // vence esta seção, que traz a frase pronta — a única forma de o bot não
    // perguntar é a instrução não existir. Quem responde um story querendo
    // saber o preço não está pronto pra falar de entrada e parcela.
    .filter((k) => k !== 'financial' || canal === 'whatsapp' || falouDePagamento);
  const fordBlock = fordKeys.length > 0
    ? `\n\n## Qualificação natural do cliente (FORD)\n\nFORD é técnica de qualificação E rapport: descubra quem é o cliente pra recomendar o carro certo e criar conexão. Não é formulário — é conversa. Descubra naturalmente, SEM interrogatório, diluído ao longo do papo:\n\n${fordKeys.map((k) => FORD_LINES[k]).join('\n\n')}\n\n- **D = Desejos/Objetivo** → o gatilho emocional da compra (use pra RECOMENDAR e conectar): "O que é mais importante pra você num carro: economia, conforto, potência ou visual?", "Tem algum carro que sempre foi seu sonho?", "O que te faria bater o martelo?". Use isso pra apontar o carro certo do estoque. (Não há campo próprio — serve pra recomendação.)\n\nComo aplicar: ENCAIXE no contexto em vez de recitar (falou que viaja → puxa Recreação; falou dos filhos → cobre Família), e COMENTE a resposta antes de seguir, pra mostrar que ouviu: "Boa! Então espaço e segurança vão importar, já entendi." Uma pergunta de cada vez, sempre reagindo à anterior.`
    : '';

  // Pré-avaliação de troca — só inclui se o toggle estiver ativo no tenant.
  const tradeInEnabled = settings.trade_in_evaluation_enabled !== false; // default ON
  const tradeInExtra = String(settings.trade_in_extra_questions ?? '').trim();
  // Cada pergunta da troca liga/desliga separadamente. Antes era tudo-ou-nada, e
  // pergunta que cai bem numa loja soa estranha em outra ("nota de 0 a 10" é o
  // caso clássico). Mesmo molde do ford_qualification: mapa de linhas filtrado
  // pelos toggles, numerado depois — assim desligar a 3ª não deixa buraco na
  // contagem que o modelo lê.
  const TRADE_IN_LINES: Record<string, string> = {
    modelo:     '**Modelo (marca e modelo)** — "E qual é o seu atual?", "Você tem o quê hoje?"',
    ano:        '**Ano** — "É de qual ano?"',
    km:         '**Quilometragem aproximada** — "Tá com quantos km mais ou menos?"',
    tempo_dono: '**Há quanto tempo é dono** — "Faz tempo que tá com ele?"',
    nota:       '**Nota de 0 a 10 que daria pro carro** — "Numa escala de 0 a 10, que nota você daria pra ele?"',
    pagamento:  '**Forma de pagamento desejada** — "Você quer trocar diretinho, ou já tá pensando em pagar uma diferença?"\n   - Se for diferença: "A diferença você quer pagar à vista ou financiar?"',
  };
  const tradeInCfg = (settings.trade_in_questions && typeof settings.trade_in_questions === 'object')
    ? settings.trade_in_questions as Record<string, unknown>
    : null;
  // cfg null (coluna nunca configurada) → tudo ON, igual ao default da migration.
  const tradeInKeys = (['modelo', 'ano', 'km', 'tempo_dono', 'nota', 'pagamento'] as const)
    .filter((k) => tradeInCfg ? tradeInCfg[k] !== false : true)
    // Mesma regra do FORD financeiro: nos canais sociais a pergunta de pagamento
    // só entra depois que o cliente tocar no assunto. Eu havia travado só o FORD
    // e esta escapou — ela traz "quer trocar diretinho ou pagar uma diferença?"
    // e "à vista ou financiar?", que é exatamente o que não pode aparecer na
    // primeira resposta de quem só perguntou o preço.
    .filter((k) => k !== 'pagamento' || canal === 'whatsapp' || falouDePagamento);
  const tradeInPerguntas = tradeInKeys
    .map((k, i) => `${i + 1}. ${TRADE_IN_LINES[k]}`)
    .join('\n');

  const tradeInBlock = (tradeInEnabled && tradeInKeys.length)
    ? `\n\n## Pré-avaliação do carro do cliente (quando há troca)\n\nQuando o cliente mencionar que TEM um carro pra dar de entrada/trocar/vender, OU quando você perceber que ele já tá decidido por um carro e ainda não falou sobre troca, descubra naturalmente as seguintes informações:\n\n${tradeInPerguntas}\n\nREGRAS importantes:\n- Pergunte APENAS o que está na lista acima. Se algo não está listado, a loja decidiu não perguntar — não improvise.\n- Distribua as perguntas ao longo da conversa, NÃO em sequência rápida (vira interrogatório)\n- Pergunte com naturalidade, frases curtas\n- Use a tool save_trade_in_evaluation pra ir salvando aos poucos cada informação que descobrir\n- Se o cliente mencionar algo extra sobre o carro (cor, modificações, "tá batidinho na lateral"), salve no campo extra_info`
      + (tradeInExtra ? `\n\n## Perguntas adicionais (configuradas pela loja)\n\nAlém das perguntas padrão acima, descubra também:\n${tradeInExtra}\n\nQuando obter resposta dessas perguntas extras, salve no campo extra_info junto com as outras informações extras.` : '')
    : '';

  // Equipe e contatos de outros setores. Duas lacunas que apareciam na
  // conversa real: o cliente cita alguem da loja ("falei com o Rodrigo") e o
  // bot improvisa, soando como se a loja nao conhecesse o proprio time; e o
  // cliente pergunta de consignacao/administrativo, que ficam em OUTRO numero,
  // e o bot nao tem o que passar.
  type Membro  = { nome?: string; funcao?: string };
  type Contato = { setor?: string; telefone?: string; quando_usar?: string };
  const equipe = Array.isArray(settings.team_members)
    ? (settings.team_members as Membro[]).filter((m) => String(m?.nome ?? '').trim())
    : [];
  const contatosSetor = Array.isArray(settings.department_contacts)
    ? (settings.department_contacts as Contato[]).filter((c) => String(c?.telefone ?? '').trim())
    : [];

  const listaEquipe = equipe
    .map((m) => `- ${String(m.nome).trim()}${m.funcao ? ` — ${String(m.funcao).trim()}` : ''}`)
    .join('\n');
  const listaContatos = contatosSetor
    .map((c) => `- ${String(c.setor ?? 'Setor').trim()}: ${String(c.telefone).trim()}`
      + (c.quando_usar ? ` — encaminhe quando: ${String(c.quando_usar).trim()}` : ''))
    .join('\n');

  // Em que canal esta conversa acontece. Sem isto o bot respondia "esse aqui e
  // o WhatsApp de vendas" DENTRO do Instagram — afirmacao falsa, e o cliente
  // que pediu o WhatsApp continuava sem o numero.
  const whatsappDaLoja = String(settings.whatsapp_number ?? '').trim();
  const NOME_CANAL: Record<string, string> = {
    whatsapp: 'WhatsApp', instagram: 'Direct do Instagram', messenger: 'Messenger',
  };
  const canalBlock = `\n\n## Onde esta conversa esta acontecendo\n\n`
    + `Você está atendendo pelo **${NOME_CANAL[canal] ?? 'WhatsApp'}**. Nunca diga que está em outro canal.`
    + (canal === 'whatsapp'
        ? `\n- Se o cliente pedir "o WhatsApp de vocês", ele JÁ está falando com você por aqui. Diga isso, sem passar outro número de vendas.`
        : (whatsappDaLoja
            ? `\n- Se o cliente pedir o WhatsApp, passe **${whatsappDaLoja}** — é o número de vendas da loja.`
              + `\n- Convide para continuar por lá quando fizer sentido (mandar fotos, simulação, agendar), mas só depois de já ter ajudado aqui. Não empurre logo na primeira mensagem.`
            : `\n- O WhatsApp da loja não está cadastrado no sistema. Se o cliente pedir, diga que vai confirmar com a equipe e chame chamar_atendente. NÃO invente número.`))
    // Ritmo do canal. Quem chega pelo Direct vem de story ou anúncio, com uma
    // pergunta curta e específica — é contato mais frio que o do WhatsApp.
    // Abrir com financiamento nesse ponto queima o lead, que foi o que
    // aconteceu no teste de 21/08.
    + (canal === 'whatsapp' ? '' : `

### Ritmo neste canal

Quem chega por aqui costuma vir de um story ou anúncio e faz uma pergunta curta e específica — "quanto?", "tem esse?". É um contato mais frio e mais curto que o do WhatsApp.

- **RESPONDA A PERGUNTA PRIMEIRO.** Preço, disponibilidade, ano, km: o que ele pediu, direto, antes de qualquer pergunta sua.
- Depois de responder, faça **no máximo UMA** pergunta, e leve. Ex.: "tá procurando pra uso na cidade ou pra estrada?"
- **NÃO fale de financiamento, entrada, parcela nem troca na primeira resposta.** Isso vem depois, e só se ele demonstrar interesse real no carro. Puxar pagamento logo de cara faz o cliente sumir.
- Mensagens mais curtas que no WhatsApp: duas ou três linhas bastam.`);

  const equipeBlock = (equipe.length || contatosSetor.length)
    ? `\n\n## Equipe da loja e outros setores`
      + (equipe.length
          ? `\n\nQuem trabalha na loja:\n${listaEquipe}\n\n`
            + `Se o cliente citar alguem dessa lista, confirme com naturalidade que a pessoa e da equipe e siga a conversa.\n`
            + `Se citar um nome que NAO esta na lista, NAO diga que a pessoa nao trabalha aqui — a lista pode estar desatualizada, e negar um funcionario real na frente do cliente e pior do que nao saber. Diga que vai confirmar e chame a tool chamar_atendente.`
          : '')
      + (contatosSetor.length
          ? `\n\nVoce e o atendimento de VENDAS. Outros assuntos sao atendidos em numeros diferentes:\n${listaContatos}\n\n`
            + `REGRA RIGIDA sobre telefone:\n`
            + `- So escreva um numero que esteja EXATAMENTE na lista acima, copiado digito por digito.\n`
            + `- NUNCA invente, complete nem "corrija" um numero.\n`
            + `- Se o assunto nao tem setor cadastrado, nao invente contato: diga que vai confirmar com a equipe.`
          : '')
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

1. ${nomeCliente ? `**O nome dele é ${nomeCliente} e você JÁ SABE — não pergunte.** Use durante a conversa, com parcimônia.` : '**Pergunte o nome do cliente no INÍCIO** (1ª ou 2ª mensagem) e use-o durante toda a conversa.'}
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
- **Depois de mandar as FOTOS de um carro, convide para ver pessoalmente.** Foto pedida é interesse declarado, e é o melhor momento do atendimento inteiro: quem fecha carro é a visita, não a conversa. Convide UMA vez, de forma natural (\"Quer dar uma olhada nele pessoalmente? Consigo separar um horário pra você\") e, se ele topar, siga a ordem da regra 2 da condução — dia primeiro, depois período. Se recusar ou desconversar, NÃO insista: volte a ajudar normalmente e só convide de novo se ele demonstrar interesse em outro carro. As regras de horário da loja valem acima desta: loja fechada hoje, convide para o próximo dia em que ela abre.
- **Contorne a PRIMEIRA objeção (1 vez), com jeito.** Se o cliente recusar, entenda o porquê e ofereça um ângulo novo OU outra opção real. Ex: "não gosto de Polo" → "entendi! e o que mais te chama num carro: economia, espaço ou um visual mais esportivo? Pergunto porque tenho [opção real] que pode combinar". Se recusar de novo / disser um "não" claro → RESPEITE, não insista uma terceira vez.

## Fluxo de qualificação (o funil — você CONDUZ, não espera)

Independente de como o cliente entra (pedindo um modelo, querendo "ver o estoque", ou já oferecendo o carro dele na troca), mantenha este funil — adaptando a ORDEM ao que ele trouxer primeiro, sem pular etapas:

1. ${nomeCliente ? `**Nome** — já é conhecido (${nomeCliente}). Etapa CUMPRIDA: não pergunte e não chame salvar_nome_cliente.` : '**Nome** — pegue logo no início (e chame salvar_nome_cliente).'}
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

## Quem manda no ritmo é o CLIENTE

Oferecer horário é certo. Insistir depois que ele respondeu, não.

- **Ele pediu tempo** ("só preciso confirmar o horário", "vou ver e te falo", "depois te aviso", "deixa eu ver com minha esposa") → ACEITE na hora e PARE de perguntar. "Tranquilo, fico no aguardo! Quando confirmar é só me chamar." Não repita as opções, não ofereça outro horário, não force. Ele volta.
- **Ele sugeriu outro dia ou horário** → vá pelo dele. Confira em ver_horarios_disponiveis e, se estiver livre, agende NO HORÁRIO QUE ELE PEDIU. Só ofereça alternativa se o dele estiver mesmo indisponível.
- **NUNCA mande a mesma pergunta duas vezes.** Se ele não respondeu o que você esperava, é porque respondeu outra coisa — leia de novo o que ele disse e trate aquilo. Repetir a frase soa que você não escutou.
- **Toda pergunta dele merece resposta.** Se ele perguntar de um modelo no meio de outro assunto ("Fiorino não tem?"), responda ANTES de seguir seu roteiro. Pergunta ignorada é cliente perdido.
- **NUNCA termine em "não tenho essa informação".** Isso é um beco sem saída: o cliente perguntou algo legítimo (aro da roda, se tem manual, quantos donos, se aceita troca por moto) e recebe uma porta fechada. Toda pergunta que você não consegue responder pelas ferramentas vira a MESMA coisa: diga que vai confirmar com a equipe e **chame \`chamar_atendente\`**. Exemplo: "Boa pergunta! Esse detalhe não está aqui comigo — já vou confirmar com a equipe e te falo em seguida 😊". Prometer e não chamar é pior que não prometer: o cliente fica esperando uma resposta que nunca vem.
- **"Com quem eu falo?" é apresentação, não desafio.** Responda com naturalidade — seu nome e que é da equipe da loja — e siga. NÃO responda com "pode falar comigo mesmo", "sou eu mesmo" ou qualquer variação que soe defensiva: a pessoa só quer saber com quem está falando. Exemplo: "Sou da equipe da ${company} 😊 E você, como se chama?"

## Quando o cliente achar caro — NÃO troque o carro na primeira objeção

Achar caro é a objeção mais comum da venda, e não significa desistência: o
cliente ainda quer AQUELE carro. Trocar de veículo na hora é o pior erro — soa
que você desistiu de vender esse e o empurra pra qualquer coisa. Foi o que
aconteceu com o Henrique: ele achou a Parati cara e recebeu um Fusca 1978, que
não tem nada a ver com o que ele procurava.

**Primeira objeção → defenda o carro, não baixe o preço:**
1. Acolha sem discutir ("Entendo, Henrique").
2. Justifique o valor com o que o carro REALMENTE tem — use só o que veio do
   consultar_estoque: equipamentos, quilometragem, estado, ano, itens de série.
   Nunca invente diferencial.
3. Chame pra ver pessoalmente: "o jeito de sentir se vale é vendo de perto —
   quer dar uma passada aqui pra conhecer?".

**Se ele insistir no preço, ou fizer uma OFERTA em dinheiro** ("faço por 17",
"consegue baixar?"): você NÃO negocia valor nem dá desconto por conta própria —
isso é decisão da loja. Diga que vai levar a proposta pra equipe avaliar e chame
\`chamar_atendente\`. Nunca recuse a oferta na hora nem diga que não tem desconto.

**Só DEPOIS da segunda recusa** ofereça outro veículo — e pergunte antes:
"Quer que eu veja o que temos na sua faixa?". Se ele aceitar, ofereça carro com
o MESMO propósito (mesmo porte, mesmo tipo de uso). Sedan compacto não vira
clássico de coleção; carro de família não vira carro de duas portas.

## Quando o cliente manda FOTO de um carro

Ele quer saber se você tem aquele carro, ou algo parecido.

- **NUNCA afirme o modelo. Sempre confirme.** Diga o que parece e pergunte:
  "Esse parece um Gol, é isso mesmo?". O cliente sabe qual carro ele
  fotografou — errar com confiança destrói a credibilidade na hora, e com a
  pergunta um erro vira conversa.
- Depois de identificar, **chame consultar_estoque** com marca e modelo. Tendo,
  apresente. Não tendo, ofereça o que há de parecido — mesmo porte e mesmo uso.
- **Foto do carro do cliente** (troca): comente o que dá pra ver e registre com
  save_trade_in_evaluation. **NUNCA estime valor por foto** — avaliação só na
  loja, com a equipe vendo o carro.
- **Não consegue identificar?** Peça ajuda em vez de chutar: "Não consegui
  ver direito o modelo — me diz qual é que eu já procuro aqui".

## Limites (vendedor bom, não chato)

- Nada de pressão desonesta, falsa urgência, mentira sobre o carro ou esconder defeito.
- Se o cliente sinalizar que quer ir no ritmo dele, respeite. O objetivo é ser um vendedor bom e simpático, não insistente.

## NUNCA insinue que a loja poderia enganar alguém

Isto vale mais que qualquer piada ou quebra-gelo. Frases como "não tem como
enrolar você", "com você não dá pra passar a perna", "você entende, então não
tem conversa fiada" **plantam a ideia de que a loja enrola os outros clientes** —
e destroem a confiança justamente com quem estava mais perto de comprar.
É proibido, mesmo em tom de brincadeira, mesmo pra elogiar.

- Cliente que entende de carro (mecânico, funileiro, taxista, já teve o mesmo
  modelo) → trate como **facilidade**, não como ameaça: "Então você já sabe o
  que olhar num carro desses 😄 qualquer detalhe que quiser conferir, é só
  perguntar." Nunca posicione a conversa como uma disputa em que alguém tenta
  levar vantagem.
- Não comente a profissão dele de um jeito que sugira desconfiança de parte a
  parte. Elogie o conhecimento, não a capacidade de "não ser enganado".`;

  return `Você é um vendedor experiente da **${company}**, uma concessionária de veículos. Você conversa com clientes pelo WhatsApp como uma pessoa de verdade.

## Informações da concessionária

- Nome: ${company}
- Endereço: ${address}
- Telefone: ${phone}
- Horário de funcionamento: ${horarios}
- Data de hoje (Brasília): ${todayLabel}${nomeInfo}${toqueNoMenuInfo}${primeiroContatoInfo}

Use a data de hoje como referência sempre que o cliente falar em datas relativas ("hoje", "amanhã", "sexta que vem", "fim de semana"). Nunca ofereça nem confirme horário fora do funcionamento da loja: a agenda real — só com horários válidos e que ainda não passaram hoje — vem sempre do ver_horarios_disponiveis; ofereça apenas os horarios_livres que ela retornar.

## Seu papel

Você atende os clientes de forma cordial e eficiente, ajudando com:

- Dúvidas sobre os veículos disponíveis no estoque
- Agendamento de visitas à concessionária
- Registro do interesse do cliente

Seu objetivo é entender o que o cliente procura, mostrar as opções que a concessionária tem, e conduzi-lo a agendar uma visita.${conductionBlock}

## Nome do cliente

- **Se você ainda não souber o nome do cliente, pergunte no começo da conversa.** Exemplo: "Pra começar, qual o seu nome?"
- Quando o cliente informar o nome, chame imediatamente a ferramenta \`salvar_nome_cliente\`.
- **Use o primeiro nome com parcimônia.** No cumprimento e num momento ou outro que peça, nunca em toda mensagem. Ninguém repete o nome do interlocutor a cada frase — fazer isso é a marca registrada de robô, e o cliente sente na hora.

## Tom e estilo de conversa

- Fale como um bom vendedor humano: cordial, prestativo, próximo, mas profissional.
- Escreva como no WhatsApp: mensagens curtas e naturais. Nada de textão corporativo.
- **NÃO monte listas com marcadores.** Vendedor não manda tópico com traço ou bolinha — ele escreve corrido. Em vez de listar preço, km, câmbio e cor em linhas separadas, diga numa frase: "É um Nivus Confortline 2023, azul, com 51 mil km, automático, por R\$ 104.900."
- **Nunca use travessão nem hífen no meio da frase** (— ou –). Pessoa nenhuma escreve assim no WhatsApp; é marca de texto gerado. Use vírgula, ponto, ou reescreva a frase.
- **Quebre a resposta em parágrafos curtos** quando houver mais de uma ideia — por exemplo, responder o preço e depois convidar pra ver o carro. Cada parágrafo é enviado como uma MENSAGEM SEPARADA, que é como gente escreve no WhatsApp. Dois parágrafos é o ideal; três é o máximo.
- **Ponto de exclamação com parcimônia**: no máximo um por mensagem, e nem em toda mensagem. Várias exclamações seguidas soam artificiais, de robô animado demais.
- **Emoji é raro**: no máximo um a cada várias mensagens, e só quando cabe de verdade. Mensagem sem emoji nenhum é o normal, não a exceção.
- Não use formatação de markdown (como \`**\` ou \`##\`). Se precisar destacar algo, use o negrito do WhatsApp (\`*texto*\` com um asterisco só), com parcimônia.
- Não despeje informação. Responda o que foi perguntado e conduza a conversa com naturalidade.
- Faça uma pergunta de cada vez, como numa conversa de verdade.
- **Responda ao que a pessoa acabou de dizer antes de puxar o próximo assunto.** Se ela contou que o carro é pra família, comente isso. Emendar outra pergunta sem reagir à resposta anterior é o que mais faz a conversa parecer formulário.

### Quando o cliente disser que está acima do orçamento

Não emende com financiamento nem pergunte quanto ele tem de entrada. Soa como cobrança, e é o momento em que a maioria some da conversa.

Reconheça o que ele falou e siga por um destes dois caminhos: mostre por que aquele carro vale o que custa (o que ele tem de diferente, estado, equipamentos), ou ofereça uma alternativa real do estoque que caiba melhor. Só fale de financiamento se ELE perguntar.

## NUNCA argumente contra a própria venda

Se o cliente perguntar sobre um carro específico, **responda sobre aquele carro** e siga a conversa. Ponto.

Está PROIBIDO lembrar o cliente de que o carro está acima do orçamento que ele mencionou. Nada de "mas ele tá bem acima dos R\$ 20.000 que você falou", "esse foge da sua faixa" ou "ainda assim tem interesse?". Quem decide o que cabe no bolso é ele, não você — e ele já sabe o próprio orçamento.

Quando o cliente pergunta por um carro mais caro do que disse antes, isso é INTERESSE, não engano. Trate como oportunidade: responda com entusiasmo contido, mostre o valor do carro, e só fale de condição de pagamento se ELE puxar.

**Vale nos DOIS sentidos, e o segundo é o que mais escapa.** Tanto faz se ele falou o orçamento antes ou depois de você mostrar o carro. Se você apresentou um carro de R\$ 47.900 e só então ele disse "até 40 mil", a resposta NÃO é reconciliar os dois números. Ele sabe fazer a conta. Apresente o carro pelo que ele é, diga o preço com naturalidade e siga.

Está proibido, em qualquer ordem: "ele tá um pouco acima do que você falou", "foge da sua faixa", "sei que é mais do que você queria, mas". Nenhuma dessas frases já vendeu um carro — todas dão ao cliente o argumento pronto pra encerrar.

E nunca minimize a diferença com "um pouco". Chamar R\$ 7.900 de "um pouco acima" é o pior dos dois mundos: lembra o cliente do problema E soa desonesto. Se o assunto do preço vier, que venha DELE.

Se em algum momento fizer sentido mostrar algo mais em conta, ofereça como ADIÇÃO ("tenho também um X, se quiser comparar"), nunca como correção do que ele pediu.

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
  }${canalBlock}${paymentBlock}${fordBlock}${tradeInBlock}${equipeBlock}${visitReminderBlock}`;
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
  // Nos canais sociais customer_phone guarda o PSID/IGSID, nao um telefone
  // (ver comentario da migration 056).
  const canal = String(conv.channel ?? 'whatsapp');
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

  // ── 3.5. A chave do lote ──────────────────────────────────────────────
  //    Identifica este lote pela ultima mensagem do cliente. So e CALCULADA
  //    aqui; quem marca ela e o passo 3.7, depois da trava.
  const { data: latestCustomerMsg } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('role', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const batchKey = latestCustomerMsg?.id ?? `welcome-${conversationId}`;

  // A ORDEM AQUI IMPORTA, e ja custou pergunta de cliente.
  //
  // A trava vem ANTES da marca da chave. Quando era o contrario:
  //
  //   1. "Amanha mesmo" chega  -> chamada A assume e comeca a gerar
  //   2. "financiam?" chega    -> chamada B MARCA a chave
  //   3. B tenta travar, ve A gerando, marca reprocess_pending e sai
  //   4. A termina e dispara a rodada C
  //   5. C calcula a mesma chave... que B ja tinha queimado no passo 2
  //      -> "lote ja assumido" -> aborta sem responder
  //
  // A pergunta do cliente sumia sem erro nenhum. B marcava a chave e nao
  // processava nada, e a rodada de reprocessamento era recusada pela marca da
  // propria B. Acontecia sempre que o cliente mandava duas mensagens enquanto
  // o bot ainda estava escrevendo — que e o normal de quem esta com pressa.
  //
  // Com a trava primeiro, quem desiste nao chega a marcar nada.

  // ── 3.6. Trava POR CONVERSA ───────────────────────────────────────────────
  //
  // A dedupe acima compara CHAVES: ela impede duas execuções com a mesma
  // mensagem, e deixa passar duas execuções simultâneas com mensagens
  // diferentes — que é exatamente o caso que duplicou a resposta na DSC. O
  // cliente escolheu o Celta, o modelo começou a gerar, e um minuto depois ele
  // mandou "O de 24.900": chave nova, trava vencida, duas simulações enviadas.
  //
  // Esta é exclusão mútua de verdade: uma geração por conversa, ponto.
  //
  // Vence em 3 minutos de propósito. Execução que morre no meio (timeout do
  // modelo, deploy, erro não tratado) deixaria a conversa muda para sempre —
  // e conversa muda é a pior falha que este produto pode ter.
  const LOCK_MAX_MS = 3 * 60_000;
  const limiteLock  = new Date(Date.now() - LOCK_MAX_MS).toISOString();

  const { data: travou, error: lockErr } = await supabase
    .from('conversations')
    .update({ processing_since: new Date().toISOString() })
    .eq('id', conversationId)
    .or(`processing_since.is.null,processing_since.lt.${limiteLock}`)
    .select('id')
    .maybeSingle();

  if (lockErr) {
    // Coluna ainda não criada (migration 076 não rodou): não trava o bot, só
    // avisa. Volta a valer sozinho quando a coluna existir.
    log.warn('trava por conversa indisponível — seguindo sem ela', { action: 'lock', error: lockErr.message });
  } else if (!travou) {
    // Já tem alguém gerando. Não descarta a mensagem: marca que sobrou coisa
    // pra responder, e quem está lá dentro dispara outra rodada ao terminar.
    await supabase.from('conversations')
      .update({ reprocess_pending: true })
      .eq('id', conversationId);
    log.info('outra geração em curso — marcado para reprocessar', { action: 'lock' });
    return new Response('OK', { status: 200 });
  }

  // ── 3.7. Dedupe por chave, agora com a trava na mao ────────────────────
  //
  // Continua valendo contra entrega repetida do mesmo webhook depois que a
  // trava ja foi solta. A diferenca e que agora so marca quem de fato vai
  // processar.
  const { data: claimed, error: claimErr } = await supabase
    .from('conversations')
    .update({ last_handled_msg_id: batchKey })
    .eq('id', conversationId)
    .or(`last_handled_msg_id.is.null,last_handled_msg_id.neq.${batchKey}`)
    .select('id')
    .maybeSingle();

  if (claimErr) {
    // A coluna last_handled_msg_id pode ainda nao existir — nao bloqueia o bot,
    // apenas registra. A dedupe passa a valer assim que a coluna for criada.
    log.warn('claim ignorado (coluna last_handled_msg_id existe?) — dedupe desativada', { action: 'claim', error: claimErr.message });
  } else if (!claimed) {
    // Solta a trava antes de sair: sem isto a conversa ficaria presa ate os 3
    // minutos vencerem, e o bot mudo nesse intervalo.
    await supabase.from('conversations')
      .update({ processing_since: null })
      .eq('id', conversationId);
    log.info('lote ja assumido por outra invocacao — abortando', { action: 'claim', batchKey });
    return new Response('OK', { status: 200 });
  }

  /**
   * Libera a conversa e, se chegou mensagem durante a geração, dispara de novo.
   *
   * Chamada no fim do caminho de sucesso. Os outros caminhos de saída contam
   * com a expiração de 3 minutos — preferi isso a espalhar `finally` por uma
   * função desta altura, onde esquecer um `return` reintroduziria o bug.
   */
  const liberarConversa = async () => {
    const { data: conv } = await supabase
      .from('conversations')
      .update({ processing_since: null })
      .eq('id', conversationId)
      .select('reprocess_pending')
      .maybeSingle();

    if (!conv?.reprocess_pending) return;

    await supabase.from('conversations')
      .update({ reprocess_pending: false })
      .eq('id', conversationId);

    log.info('mensagem chegou durante a geração — rodando de novo', { action: 'lock' });
    // @ts-ignore — EdgeRuntime é global nas Supabase Edge Functions
    EdgeRuntime.waitUntil(
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-conversation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch((e) => log.warn('falha ao reprocessar', { action: 'lock', error: String(e) })),
    );
  };

  // ── 3b. O bot PODE falar nesta conta? ─────────────────────────────────────
  //
  // A trava vive aqui, e nao so em quem chama, porque este e o unico ponto por
  // onde o bot fala. Ela nasceu dentro do whatsapp-webhook: o social-webhook
  // foi escrito depois e passou meses sem nenhuma verificacao, e o
  // devolver-ao-bot, escrito ontem, tambem chamava direto.
  //
  // Guarda em quem chama e guarda que a proxima porta esquece. Esta e a ultima.
  //
  // Vem ANTES das boas-vindas de proposito: aquele bloco JA ENVIA mensagem.
  const { data: guardas } = await supabase
    .from('company_settings')
    .select(COLUNAS_GUARDA)
    .eq('user_id', userId)
    .maybeSingle();

  if (guardas && !botPodeResponder(guardas)) {
    await supabase.from('conversations')
      .update({ status: 'pending' })
      .eq('id', conversationId)
      .neq('status', 'human');
    log.info('bot nao pode responder nesta conta', {
      action: 'guarda',
      contratado: (guardas as { bot_contratado?: boolean }).bot_contratado,
      suspenso: (guardas as { suspenso?: boolean }).suspenso,
    });
    return new Response('OK', { status: 200 });
  }

  // ── 4. Boas-vindas: primeira mensagem da conversa ─────────────────────────
  // Boas-vindas enlatada SO quando a primeira mensagem nao traz conteudo.
  //
  // Antes ela disparava sempre e dava `return`, ou seja: quem abria com "Qual o
  // valor?" e a foto de um story recebia "qual o seu nome?" e tinha a pergunta
  // ignorada. Pior: o turno da imagem era gasto, e na vez seguinte a foto ja
  // era historico — o modelo respondia as cegas e perguntava se era compacto,
  // SUV ou picape com o carro na tela do cliente.
  const aberturaTexto = String(latestCustomerMsg?.content ?? '').trim();
  const soCumprimento =
    !/^\[(imagem|foto|audio)\]/i.test(aberturaTexto)
    && aberturaTexto.length <= 25
    && /^(oi+|ol[áa]+|opa|e a[ií]|bo[am] (dia|tarde|noite)|hey|hi|blz|beleza|tudo bem)\b/i.test(aberturaTexto);

  if (isFirstMessage && soCumprimento) {
    const { data: wSettings } = await supabase
      .from('company_settings')
      .select('company_name, whatsapp_phone_number_id, ig_user_id, fb_page_id')
      .eq('user_id', userId)
      .single();

    const companyName = String(wSettings?.company_name ?? 'nossa concessionária');
    // Sai pelo número da CONVERSA, não pelo principal da loja.
    //
    // Com três números, usar o principal aqui fazia o cliente escrever pro
    // número 2 e receber a primeira resposta do número 1 — no pior lugar
    // possível, que é a abertura do atendimento.
    const wPid        = String(
      (conv as { phone_number_id?: string | null })?.phone_number_id
      || wSettings?.whatsapp_phone_number_id
      || '',
    );
    const wToken      = await resolveWhatsAppToken(supabase, userId);

    // No Instagram e no Messenger o nome vem no proprio webhook, do perfil da
    // conta. Perguntar "qual o seu nome?" pra quem acabou de mandar mensagem
    // com o nome estampado no topo da conversa era a coisa mais robotica que
    // este bot fazia.
    //
    // No WhatsApp continua perguntando de proposito: la o nome de perfil e o
    // que a pessoa escolheu ("Ju 💜", "Casa", "Oficina do Ze"), e tratar aquilo
    // como nome proprio sai pior que perguntar.
    const { data: convNome } = await supabase
      .from('conversations').select('customer_name').eq('id', conversationId).maybeSingle();

    const primeiroNome = String(convNome?.customer_name ?? '').trim().split(/\s+/)[0] ?? '';
    const jaSeiONome = canal !== 'whatsapp'
      && primeiroNome.length >= 2
      && !/^\d+$/.test(primeiroNome);

    const welcomeText = jaSeiONome
      ? `Oi, ${primeiroNome}! Aqui é da ${companyName}. Em que posso ajudar?`
      : `Olá! Bem-vindo à ${companyName}.\n\nPra começar, qual o seu nome?`;

    // Envia ANTES de gravar: o wamid só existe depois da resposta da Meta, e é
    // ele que liga esta mensagem aos webhooks de entregue/lido.
    //
    // Este caminho é separado do envio final (seção 8) e precisa da mesma
    // escolha de canal. Sem ela, a boas-vindas do Instagram ia pro WhatsApp com
    // o IGSID no lugar do telefone — e o pior: a API do WhatsApp ACEITA um
    // número longo qualquer e devolve wamid, então o log dizia "enviadas" e só
    // o webhook de status revelava a falha, já com o "!" na tela do lojista.
    let wSent = false;
    let wWamid: string | null = null;

    if (canal === 'whatsapp') {
      const r = await sendMessageComId(customerPhone, welcomeText, wPid || undefined, wToken, log);
      wSent = r.ok; wWamid = r.wamid;
    } else {
      const contaW = String(
        (canal === 'instagram' ? wSettings?.ig_user_id : wSettings?.fb_page_id) ?? '',
      );
      const { data: tokW } = await supabase.rpc('get_meta_page_token', { p_user_id: userId, p_canal: canal });
      const r = await enviarSocial(contaW, customerPhone, welcomeText, String(tokW ?? ''), canal as 'instagram' | 'messenger');
      wSent = r.ok;
      wWamid = r.mid ?? null;
      if (!r.ok) log.error('falha ao enviar boas-vindas no canal social', { action: 'welcome', canal, erro: r.erro });
    }

    if (wSent) log.info('boas-vindas enviadas', { action: 'welcome', canal, wamid: wWamid });
    else log.error('falha ao enviar boas-vindas', { action: 'welcome', canal });

    const now = new Date().toISOString();
    await supabase.from('messages').insert({
      conversation_id: conversationId, role: 'bot', content: welcomeText,
      wa_message_id: wWamid, wa_status: wSent ? 'sent' : 'failed',
    });
    await supabase.from('conversations').update({ last_message_at: now }).eq('id', conversationId);

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

  // ── Captura automática do que o cliente já respondeu ──────────────────────
  //    Estes campos só eram preenchidos quando o MODELO lembrava de chamar a
  //    tool de qualificação. Quando ele esquecia, o bloco abaixo dizia "FALTA"
  //    e ele reperguntava — fazendo o que o prompt mandava, sem saber que já
  //    tinha perguntado. Caso do Jeberson (13/08): resolveu pagamento às 13:55
  //    e às 14:26 ouviu "financia ou à vista?" de novo.
  //
  //    Guarda o texto CRU da fala dele. O campo não precisa ser relatório:
  //    precisa dizer ao modelo "essa dimensão já foi coberta, siga em frente".
  //    Só preenche campo VAZIO — nunca sobrescreve o que a tool salvou.
  const ultimaFalaCliente = [...orderedMessages].reverse()
    .find((m) => m.role === 'customer')?.content ?? '';

  const SINAIS: Array<[string, RegExp]> = [
    ['financial_info',  /financi|[àa]\s+vista|entrada|parcel|na troca|cart[ãa]o|\bpix\b|boleto|cons[óo]rcio/i],
    ['recreation_info', /dia a dia|fam[íi]li|trabalh|viag|estrada|cidade|passei|fim de semana/i],
    ['family_info',     /esposa|marido|filh|crian[çc]a|namorad|casad|minha mulher|meu marido/i],
  ];

  if (leadRow && ultimaFalaCliente) {
    const novos: Record<string, string> = {};
    for (const [campo, re] of SINAIS) {
      const jaTem = String((leadRow as Record<string, unknown>)[campo] ?? '').trim();
      if (!jaTem && re.test(ultimaFalaCliente)) {
        novos[campo] = ultimaFalaCliente.slice(0, 300);
        // Vale já NESTE turno: sem isso o bot ainda perguntaria de novo agora.
        (leadRow as Record<string, unknown>)[campo] = novos[campo];
      }
    }
    if (Object.keys(novos).length) {
      await supabase.from('leads')
        .update({ ...novos, updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('phone', customerPhone);
      log.info('qualificação capturada da fala do cliente', {
        action: 'auto_qualificacao', campos: Object.keys(novos),
      });
    }
  }

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
    canal,
    // O cliente já falou de pagamento? Só o que ELE escreveu conta: se olhasse
    // as falas do bot, a primeira menção dele reabriria o assunto sozinha.
    /\b(financ|parcel|entrada|cons[óo]rcio|troca|boleto|cart[ãa]o|pag(ar|amento)|[àa] vista)/i
      .test(orderedMessages.filter((m) => m.role === 'customer').map((m) => String(m.content)).join(' ')),
    // Primeiro contato: quando a abertura ja traz pergunta, a boas-vindas
    // enlatada nao dispara e quem cumprimenta e o modelo.
    isFirstMessage,
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

  // A Anthropic exige que a conversa TERMINE em mensagem do cliente. Quando não
  // termina, ela devolve 400 "does not support assistant message prefill" — que
  // não é retentável, então o turno inteiro morre na ponte de erro.
  //
  // Acontece por CORRIDA entre turnos, e as fotos tornam provável: cada foto
  // vira uma linha role='bot', o envio das 7 leva ~6s, e se o cliente escrever
  // nesse meio-tempo o turno novo carrega um histórico que termina no bot.
  // Foi exatamente isso na conversa do Cesar (12/08).
  //
  // Em vez de descartar essas linhas (o modelo reenviaria as fotos), fecha com
  // uma nota de sistema explicando o que já saiu.
  if (history[history.length - 1].role === 'assistant') {
    log.warn('histórico terminava em mensagem do bot — fechando com nota de sistema', {
      action: 'history', ultimas: history.length,
    });
    history.push({ role: 'user', content: NOTA_FECHAMENTO });
  }

  // Hora atual + expediente de hoje. Vai aqui, no fim do array, e nao no system
  // prompt: assim o modelo sabe que ja passou das 18h sem que o cache do prompt
  // seja invalidado a cada minuto.
  history.push({ role: 'user', content: notaDeHorario((settings ?? {}) as Record<string, unknown>) });

  // ── 7. Loop de chamadas ao Claude ─────────────────────────────────────────
  // Responde pelo MESMO número que recebeu.
  //
  // Com a loja tendo três números (Leadrinho), usar o da company_settings faria
  // toda resposta sair pelo principal — o cliente escreveria pro pós-venda e
  // receberia resposta do número de vendas. Além de confuso, quebraria o
  // histórico dele no WhatsApp.
  //
  // Cai no número da loja quando a conversa é antiga (antes da 083) ou quando a
  // coluna ainda não existe.
  const phoneNumberId = String(
    (conv as { phone_number_id?: string | null })?.phone_number_id
    || settings?.whatsapp_phone_number_id
    || '',
  );
  const waToken = await resolveWhatsAppToken(supabase, userId);
  // Credenciais sociais resolvidas uma vez por turno: buscar o token dentro da
  // tool faria uma consulta ao Vault por foto enviada.
  let contaIdSocial = '';
  let tokenSocial = '';
  if (canal !== 'whatsapp') {
    contaIdSocial = String((canal === 'instagram' ? settings?.ig_user_id : settings?.fb_page_id) ?? '');
    const { data: tp } = await supabase.rpc('get_meta_page_token', { p_user_id: userId, p_canal: canal });
    tokenSocial = String(tp ?? '');
  }

  const ctx = {
    userId, conversationId, customerPhone, customerName, phoneNumberId,
    token: waToken, log, canal, contaId: contaIdSocial, tokenSocial,
  };
  let finalText = '';
  const toolsUsadas = new Set<string>();  // o que o modelo REALMENTE chamou neste turno
  // Modelo que o cliente pediu e a loja nao tem — candidato a lista de espera.
  let interesseSemEstoque: { model: string; brand: string } | null = null;
  let lastWasTool = false;   // a iteração anterior executou uma tool?
  // Assinatura tool+argumentos ja executadas NESTE turno. Serve pra cortar
  // repeticao identica, que e o que faz o laco chegar no teto de 10 iteracoes.
  const jaChamadas = new Map<string, unknown>();
  const sequencia: string[] = [];   // ordem das tools, so pra diagnostico
  let retriedEmpty = false;  // já re-chamamos uma vez por resposta vazia pós-tool?
  let reformulou   = false;  // já pedimos uma reformulação por repetição?
  // O que o bot já disse nesta conversa — base da checagem de repetição.
  const botAnteriores = history
    .filter((m) => m.role === 'assistant')
    .slice(-3)
    .map((m) => m.content);

  const claudeMessages: Array<{ role: 'user' | 'assistant'; content: string | unknown[] }> = [...history];

  // ── Foto do cliente vai para o modelo VER ─────────────────────────────────
  //    Só a MAIS RECENTE, e só se for a última coisa que ele mandou. As demais
  //    ficam como texto no histórico: reenviar todas em cada chamada
  //    multiplicaria o custo de uma conversa com várias fotos.
  //    Formato de URL (não base64) porque a imagem já está no nosso Storage,
  //    público, e assim não trafega duas vezes.
  // Procura a foto do cliente nas ultimas mensagens, nao so na ULTIMA.
  //
  // Antes so a ultima contava, e bastava o cliente mandar a foto e escrever
  // qualquer coisa depois ("Fernanda", "e ai?") pra o modelo perder a imagem e
  // responder as cegas. Aconteceu numa resposta a story: ele perguntou se era
  // compacto, SUV ou picape com o carro na tela do cliente.
  //
  // Uma imagem por chamada e so enquanto recente: reenviar todas multiplicaria
  // o custo de uma conversa com varias fotos.
  const JANELA_IMAGEM = 6;
  let urlImagem = '';
  let legendaImagem = '';
  let imagemEhAtual = false;

  for (let i = orderedMessages.length - 1, n = 0; i >= 0 && n < JANELA_IMAGEM; i--, n++) {
    const m = orderedMessages[i];
    if (m?.role !== 'customer') continue;
    const achou = String(m.content).match(/^\[imagem\]\s*(https?:\/\/\S+)/i);
    if (achou) {
      urlImagem = achou[1];
      legendaImagem = String(m.content).replace(/^\[imagem\]\s*\S+/i, '').trim();
      imagemEhAtual = n === 0;
      break;
    }
  }

  if (urlImagem && provider === 'anthropic' && claudeMessages.length) {
    const ultima = claudeMessages[claudeMessages.length - 1];
    if (ultima.role === 'user') {
      const textoAtual = legendaImagem
        ? `O cliente mandou esta foto e escreveu: "${legendaImagem}"`
        : 'O cliente mandou esta foto, sem escrever nada junto.';
      const textoAntigo = `Esta e a foto que o cliente mandou ha pouco NESTA conversa${
        legendaImagem ? `, escrevendo: "${legendaImagem}"` : ''
      }. A conversa continua sobre ela — considere a imagem ao responder a mensagem atual.`;

      ultima.content = [
        { type: 'image', source: { type: 'url', url: urlImagem } },
        { type: 'text', text: imagemEhAtual ? textoAtual : textoAntigo },
      ];
      log.info('imagem do cliente enviada ao modelo', { action: 'visao', atual: imagemEhAtual });
    }
  }

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

        // Repetiu o que já mandou? Devolve pro modelo UMA vez, dizendo o que
        // fazer — o cliente já leu essa mensagem e não respondeu o que ele
        // esperava, então insistir na mesma frase é o pior caminho.
        // Exceção: se o cliente ACABOU DE PEDIR a informação, repetir é a
        // resposta certa, não um vício. Sem isto o bot dava o preço, o cliente
        // dizia "quero sim", a trava classificava como repetição e o modelo
        // mudava de assunto — deixando a pergunta sem resposta. Visto em
        // conversa real em 21/08.
        // ultimaDoCliente so e definida bem mais abaixo; aqui a ultima fala do
        // cliente vem direto das mensagens ordenadas, que ja estao em maos.
        const falaDoCliente = String(
          [...orderedMessages].reverse().find((m) => m.role === 'customer')?.content ?? '',
        ).trim();
        const pedidoExplicito = /^\s*(sim|isso|quero|pode|manda|claro|com certeza|por favor|quanto|qual)\b/i
          .test(falaDoCliente) || falaDoCliente.length <= 20;

        if (finalText && !reformulou && !pedidoExplicito && ehRepeticao(finalText, botAnteriores)) {
          log.warn('resposta repetida — pedindo reformulação', {
            action: 'claude_loop', iteration, trecho: finalText.slice(0, 120),
          });
          claudeMessages.push({ role: 'assistant', content: finalText });
          claudeMessages.push({
            role: 'user',
            content: 'Você acabou de repetir uma mensagem que já mandou nesta conversa. O cliente leu e respondeu outra coisa — insistir na mesma pergunta soa que você não escutou. Releia a ÚLTIMA mensagem dele e responda ao que ele realmente disse. Se ele pediu tempo pra confirmar, avisou que depois retorna, ou sugeriu outro horário, ACEITE: confirme que está tudo bem, diga que fica no aguardo e NÃO repita a pergunta.',
          });
          reformulou = true;
          finalText = '';
          continue;
        }

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
        sequencia.push(String(block.name ?? '?'));

        // Chamada IDENTICA (mesma tool, mesmos argumentos) ja feita neste turno.
        // Reexecutar da o mesmo resultado e o modelo tende a repetir de novo —
        // e assim o turno anda ate o teto de 10 iteracoes, cada uma pagando o
        // prefixo inteiro. Medido em 20/08: conversa de ate 5 mensagens estava
        // gastando 25 chamadas em media, pico de 55.
        const assinatura = `${block.name}:${JSON.stringify(block.input ?? {})}`;
        if (jaChamadas.has(assinatura)) {
          log.warn('tool repetida no mesmo turno — curto-circuito', {
            action: 'claude_loop', iteration, tool: block.name,
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            // Devolve o MESMO resultado (nao mente pro modelo) mais uma
            // instrucao explicita de parar de repetir e responder ao cliente.
            content: JSON.stringify({
              ...(jaChamadas.get(assinatura) as Record<string, unknown>),
              aviso_sistema: 'Você já fez exatamente esta chamada nesta mesma resposta e o resultado é o mesmo. NÃO chame de novo. Responda ao cliente agora com o que já tem.',
            }),
          });
          continue;
        }

        const result = await executeTool(
          block.name ?? '',
          (block.input ?? {}) as Record<string, unknown>,
          ctx,
          supabase,
        );
        jaChamadas.set(assinatura, result);
        // Guarda o modelo buscado sem resultado. Se uma busca POSTERIOR no mesmo
        // turno achar algo (retry de grafia, "T Cross" -> "T-Cross"), limpa: nao
        // e falta real de estoque, era so o nome escrito diferente.
        if (block.name === 'consultar_estoque') {
          const entrada = (block.input ?? {}) as Record<string, unknown>;
          const modeloBuscado = String(entrada.model ?? '').trim();
          const semMatch = (result as Record<string, unknown>)?.modo === 'sem_correspondencia';
          if (semMatch && modeloBuscado) {
            interesseSemEstoque = { model: modeloBuscado, brand: String(entrada.brand ?? '').trim() };
          } else if (!semMatch) {
            interesseSemEstoque = null;
          }
        }

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

    // Falha do modelo UMA vez é hiccup: manda uma ponte e mantém a conversa com
    // o bot (o próximo turno do cliente reativa). Falhar DUAS vezes na mesma
    // conversa não é hiccup — é o cliente batendo num bot quebrado, e aí quem
    // atende tem que ser gente.
    const jaFalhouAntes = history.some(
      (m) => m.role === 'assistant' && m.content.includes('me perdi aqui rapidinho'),
    );

    // A ponte antiga pedia pro cliente repetir o que já tinha dito ("me lembra
    // o que a gente tava vendo?") — e caía logo depois de uma resposta completa
    // do bot, o que soava quebrado. Agora ela não devolve trabalho pro cliente.
    const fallbackMsg = jaFalhouAntes
      ? 'Desculpa a demora! Já chamei uma pessoa da equipe pra te atender direitinho — é rapidinho. 🙏'
      : 'Opa, tive um probleminha aqui rapidinho 😅 pode repetir a última mensagem? Já te respondo.';

    if (jaFalhouAntes) {
      await supabase.from('conversations').update({ status: 'pending' }).eq('id', conversationId);
      avisarPendente(userId, customerName ?? '', 'O bot falhou duas vezes seguidas e passou a conversa.', conversationId);
      log.warn('segunda falha do modelo na mesma conversa — handoff', { action: 'fallback', forcado: true });
    }

    try {
      const { ok: fbSent, wamid: fbWamid } =
        await sendMessageComId(customerPhone, fallbackMsg, phoneNumberId || undefined, waToken, log);
      await supabase.from('messages').insert({
        conversation_id: conversationId, role: 'bot', content: fallbackMsg,
        wa_message_id: fbWamid, wa_status: fbSent ? 'sent' : 'failed',
      });
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
      const { ok: brSent, wamid: brWamid } =
        await sendMessageComId(customerPhone, bridge, phoneNumberId || undefined, waToken, log);
      await supabase.from('messages').insert({
        conversation_id: conversationId, role: 'bot', content: bridge,
        wa_message_id: brWamid, wa_status: brSent ? 'sent' : 'failed',
      });
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

  // ── 7c. Travas de RESGATE ──────────────────────────────────────────────────
  //    Três situações em que insistir é pior do que passar pra um humano. Todas
  //    saíram da conversa da Luciane (10/08): ela perguntou de um Prisma que a
  //    loja tinha postado no Instagram e não estava cadastrado. O bot repetiu
  //    "não está cadastrado" quatro vezes, ignorou o link do reel que ela mandou
  //    como prova, mandou ela procurar a loja PELO INSTAGRAM — o canal de onde
  //    ela veio — e continuou repetindo depois de "péssimo atendimento".
  //    Nenhum humano foi chamado em nenhum momento.
  const ultimaDoCliente = [...history].reverse()
    .find((m) => m.role === 'user' && m.content !== NOTA_FECHAMENTO)?.content ?? '';

  // (a) O cliente reclamou do atendimento. Continuar respondendo só piora.
  const INSATISFACAO =
    /p[ée]ssimo|horr[íi]vel|rid[íi]culo|absurdo|vergonha|n[ãa]o gostei|decepcion|vou reclamar|despreparad|mal atendid|atendimento ruim|in[uú]til/i;

  // (b) O bot empurrando o cliente pra outro canal. Ele É a loja: mandar
  //     "falar com a loja" em outro lugar quebra a persona (veio o "vc não é da
  //     loja?") e joga fora um atendimento que já estava na mão.
  const MANDOU_PRA_OUTRO_CANAL =
    /(instagram|direct|face(book)?|insta)\b[^.!?\n]{0,60}(pergunt|confirm|fala|manda|chama|contato)|(pergunt|confirm|fala|manda|chama|entrar? em contato)[^.!?\n]{0,60}\b(instagram|direct|face(book)?)\b|contato\s+(direto\s+)?com\s+a\s+loja/i;

  // (c) Segunda negativa de estoque na mesma conversa. Dizer "não temos" uma vez
  //     é legítimo; se o cliente insiste, quem resolve é gente — o carro pode
  //     existir de verdade e só não estar cadastrado ainda.
  const NEGATIVA_ESTOQUE =
    /n[ãa]o\s+(\w+\s+){0,2}(temos|tem|est[áa]|aparece|consta|encontr\w*|localizei|achei|cadastrad\w*)/i;
  const negativasAnteriores = history.filter(
    (m) => m.role === 'assistant' && NEGATIVA_ESTOQUE.test(m.content),
  ).length;

  // (d) O cliente afirma que VIU o carro anunciado. Aqui ele sabe algo que o
  //     sistema não sabe — a loja posta antes de cadastrar. Discutir com quem
  //     tem o link na mão é o pior caminho possível: escala já na PRIMEIRA
  //     negativa, sem esperar a segunda.
  const VIU_ANUNCIADO =
    /\b(vi|vimos|vc|vcs|voc[êe]s?)\b[^.!?\n]{0,30}\b(postaram|postou|anunciaram|anunciou|publicaram|publicou)\b|\bvi\s+(no|na|pelo|pela)\s+(instagram|insta|face|facebook|site|story|stories|status)\b|\b(no|na)\s+(an[úu]ncio|post|reel|story)\b|instagram\.com|facebook\.com/i;

  // (e) O bot prometeu CHECAR E VOLTAR. É a promessa mais comum e a que mais
  //     vaza: "esse detalhe eu confirmo com a equipe e já te passo" (Cesar,
  //     12/08, perguntando o aro da roda). A frase está certa — o erro é não
  //     chamar ninguém. A conversa segue em 'bot', o bot não tem como voltar
  //     com a resposta, e o cliente fica esperando pra sempre. Naquele dia só
  //     não virou lead perdido porque um humano notou por acaso.
  const PROMETEU_VERIFICAR =
    /(confirm\w+|verific\w+|checa\w+|pergunt\w+|vou\s+ver)\s+[^.!?\n]{0,30}\bcom\s+(a\s+|o\s+|meu\s+|minha\s+)?(equipe|gerente|superior|ger[êe]ncia|respons[áa]vel|time|pessoal|dono|propriet[áa]ri\w+|mec[âa]nic\w+)\b|\bj[áa]\s+te\s+(passo|falo|retorno|aviso|respondo|confirmo)\b|\bte\s+(retorno|respondo|confirmo)\s+(j[áa]|em|assim)/i;

  let motivoResgate: string | null = null;
  if (INSATISFACAO.test(ultimaDoCliente)) {
    motivoResgate = 'cliente reclamou do atendimento';
  } else if (MANDOU_PRA_OUTRO_CANAL.test(finalText)) {
    motivoResgate = 'bot mandou o cliente pra outro canal';
  } else if (
    (negativasAnteriores >= 1 || VIU_ANUNCIADO.test(ultimaDoCliente)) &&
    NEGATIVA_ESTOQUE.test(finalText)
  ) {
    motivoResgate = VIU_ANUNCIADO.test(ultimaDoCliente)
      ? 'cliente diz que viu o carro anunciado'
      : 'segunda negativa de estoque na mesma conversa';
  } else if (PROMETEU_VERIFICAR.test(finalText)) {
    motivoResgate = 'bot prometeu confirmar com a equipe';
  }

  if (motivoResgate && !toolsUsadas.has('chamar_atendente')) {
    await supabase.from('conversations').update({ status: 'pending' }).eq('id', conversationId);
    avisarPendente(userId, customerName ?? '', `O bot prometeu retorno da equipe (${motivoResgate}).`, conversationId);
    const nome = customerName ? `${String(customerName).split(' ')[0]}, ` : '';

    if (motivoResgate === 'cliente reclamou do atendimento') {
      // Substitui: o que o modelo ia mandar é mais do mesmo que gerou a queixa.
      finalText = `${nome}me desculpa por isso. Vou chamar agora uma pessoa da equipe pra te atender. É rapidinho, já te respondem por aqui.`;
    } else if (motivoResgate === 'bot mandou o cliente pra outro canal') {
      // Substitui: o texto é ativamente nocivo (manda o cliente embora).
      finalText = `${nome}deixa eu confirmar isso certinho com a equipe pra não te passar informação errada. Já te respondem por aqui, é rapidinho. 😊`;
    } else if (motivoResgate === 'bot prometeu confirmar com a equipe') {
      // Texto INTACTO: ele já disse a coisa certa ("confirmo com a equipe e já
      // te passo"). O defeito era só não chamar ninguém — o que a linha do
      // status acima resolve. Acrescentar aviso aqui soaria repetido.
    } else {
      // ACRESCENTA: aqui o modelo costuma ter oferecido uma alternativa boa
      // (o Onix Plus no lugar do Prisma). Chamar gente não pode custar a
      // oferta — o cliente recebe as duas coisas.
      finalText = `${finalText.trim()}\n\nE já pedi pra uma pessoa da equipe confirmar isso direitinho pra você. Em instantes te respondem por aqui.`;
    }
    log.warn('handoff de resgate', {
      action: 'chamar_atendente', forcado: true, motivo: motivoResgate, negativasAnteriores,
    });
  }

  // Sequencia de tools do turno. E o que permite descobrir QUAL tool provoca o
  // laco — sem isso so se ve o total de chamadas, que nao aponta culpado.
  if (sequencia.length >= 4) {
    log.warn('turno com muitas tools', {
      action: 'diag_laco', total: sequencia.length, sequencia: sequencia.join(' > '),
    });
  }

  // ── 7b. Lista de espera ────────────────────────────────────────────────────
  // O bot promete "registro pra te avisar quando entrar" e nao registra. A
  // descricao da tool exige duas coisas antes: que o cliente PECA pra ser
  // avisado, e que os detalhes (ano, km, preco) venham primeiro. Entao ele
  // adia — e quando emenda numa alternativa do estoque, nunca volta. Foi o caso
  // do Golf em 18/08: "antes de registrar, deixa eu te mostrar o A3". O
  // interesse morreu ali e a Lista de Espera ficou vazia.
  //
  // Aqui nao depende de o modelo lembrar: se ELE MESMO buscou o modelo e a loja
  // nao tem, registra. A tool ja tem anti-duplicacao por cliente+modelo, entao
  // chamar de novo e inofensivo.
  if (interesseSemEstoque && !toolsUsadas.has('registrar_interesse_veiculo')) {
    try {
      await executeTool(
        'registrar_interesse_veiculo',
        {
          model: interesseSemEstoque.model,
          ...(interesseSemEstoque.brand ? { brand: interesseSemEstoque.brand } : {}),
        },
        ctx,
        supabase,
      );
      log.info('interesse registrado pela trava (modelo fora de estoque)', {
        action: 'guard_lista_espera', model: interesseSemEstoque.model,
      });
    } catch (e) {
      // Nao pode derrubar a resposta: o cliente ja tem texto pra receber.
      log.error('falha ao registrar interesse pela trava', { action: 'guard_lista_espera', error: e });
    }
  }

  // ── 7c. Trava de telefone ──────────────────────────────────────────────────
  // Digito trocado e o erro mais caro desta feature: o cliente liga pra empresa
  // errada, ou pro celular de um estranho que nunca ouviu falar da loja. Pedir
  // no prompt nao basta — numero e exatamente o tipo de coisa que o modelo
  // "completa" sozinho. Entao confere aqui, contra o que a loja cadastrou.
  const soDigitos = (t: string) => t.replace(/\D/g, '').replace(/^55/, '');
  const telsCadastrados = (Array.isArray(settings?.department_contacts)
    ? (settings.department_contacts as Array<{ telefone?: string }>)
    : [])
    .map((c) => soDigitos(String(c?.telefone ?? '')))
    .filter((d) => d.length >= 10);

  // Exige 10-11 digitos (DDD + numero): assim ano ("2015 2020"), preco e
  // quilometragem nao sao confundidos com telefone.
  const candidatos = finalText.match(/(?:\+?55[\s.-]*)?\(?\d{2}\)?[\s.-]*\d{4,5}[\s.-]?\d{4}/g) ?? [];
  const naoCadastrados = candidatos.filter((c) => {
    const d = soDigitos(c);
    if (d.length < 10 || d.length > 11) return false;
    // endsWith nos dois sentidos tolera o 9o digito do celular BR.
    return !telsCadastrados.some((t) => t.endsWith(d) || d.endsWith(t));
  });

  if (naoCadastrados.length) {
    log.error('bot escreveu telefone fora do cadastro — resposta substituida', {
      action: 'guard_telefone', quantidade: naoCadastrados.length,
    });
    await supabase.from('conversations').update({ status: 'pending' }).eq('id', conversationId);
    avisarPendente(userId, customerName ?? '', 'O bot tentou passar um telefone fora do cadastro.', conversationId);
    const nomeG = customerName ? `${String(customerName).split(' ')[0]}, ` : '';
    finalText = `${nomeG}deixa eu confirmar esse contato certinho com a equipe pra nao te passar numero errado. Ja te respondem por aqui. 😊`;
  }

  // ── 8. Envia resposta ao cliente, no canal de onde ele veio ────────────────
  //
  // Resposta com mais de uma ideia vira mais de um balao, quebrando nos
  // paragrafos que o proprio modelo escreveu. Isto NAO custa token nenhum a
  // mais: o texto gerado e exatamente o mesmo, muda so quantas chamadas de
  // envio a gente faz. Vendedor humano manda assim; bloco unico de seis linhas
  // e a assinatura de robo.
  const baloes = (() => {
    const partes = finalText.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
    if (partes.length <= 1) return [finalText.trim()];
    // Acima de tres vira metralhadora e enche a tela do cliente; o excedente
    // volta pro ultimo balao.
    return partes.length > 3 ? [partes[0], partes[1], partes.slice(2).join('\n\n')] : partes;
  })();

  const contaId = canal === 'whatsapp' ? '' : String(
    (canal === 'instagram' ? settings?.ig_user_id : settings?.fb_page_id) ?? '',
  );
  // Um token so pros tres envios: buscar de novo a cada balao seria uma ida ao
  // Vault por mensagem.
  const tokenPagina = canal === 'whatsapp' ? '' : String(
    (await supabase.rpc('get_meta_page_token', { p_user_id: userId, p_canal: canal })).data ?? '',
  );

  let sent = false;
  const enviados: Array<{ texto: string; wamid: string | null; ok: boolean }> = [];

  /** Grava um balao assim que ele sai, e corrige a linha se o eco chegou antes.
   *
   *  O upsert por wa_message_id e o que cura a corrida: quando o eco venceu, a
   *  linha ja existe com role 'agent', e aqui ela volta a ser 'bot' em vez de
   *  estourar o indice unico. Sem id (envio que falhou) nao da para casar nada,
   *  entao e insert simples. */
  const gravarBalao = async (e: { texto: string; wamid: string | null; ok: boolean }) => {
    const linha = {
      conversation_id: conversationId,
      role: 'bot',
      content: e.texto,
      wa_message_id: e.wamid,
      wa_status: e.ok ? 'sent' : 'failed',
    };
    const { error } = e.wamid
      ? await supabase.from('messages').upsert(linha, { onConflict: 'wa_message_id' })
      : await supabase.from('messages').insert(linha);
    // Conferir o erro e metade do conserto: o insert em lote antigo falhava
    // calado, e foi isso que escondeu o defeito por semanas.
    if (error) log.error('falha ao gravar balao do bot', { action: 'send_final', canal, erro: error.message });
  };

  for (let i = 0; i < baloes.length; i++) {
    const parte = baloes[i];

    // Pausa entre baloes: garante a ordem de chegada e da tempo de leitura.
    // Sem ela os tres pipocam no mesmo segundo, que e justamente o que
    // denuncia automacao.
    if (i > 0) await new Promise((r) => setTimeout(r, 900));

    if (canal === 'whatsapp') {
      const r = await sendMessageComId(customerPhone, parte, phoneNumberId || undefined, waToken, log);
      enviados.push({ texto: parte, wamid: r.wamid, ok: r.ok });
    } else {
      // Instagram e Messenger: outro endpoint, outro token (o da pagina) e o
      // remetente vai na URL. O destinatario e o PSID/IGSID.
      //
      // Guarda o id de CADA balao: e o que faz o webhook reconhecer o eco como
      // sendo nosso e descartar. Guardar so o do ultimo faria os anteriores
      // voltarem como se fossem do atendente, e a conversa iria pra 'humano'.
      const r = await enviarSocial(contaId, customerPhone, parte, tokenPagina, canal as 'instagram' | 'messenger');
      enviados.push({ texto: parte, wamid: r.mid ?? null, ok: r.ok });
      if (!r.ok) log.error('falha ao enviar no canal social', { action: 'send_final', canal, erro: r.erro, balao: i });
    }

    // GRAVA AGORA, nao no fim do laco — e aqui que estava o bug.
    //
    // O eco do balao 1 volta da Meta enquanto ainda estamos mandando o 2 e o
    // 3 (sao 900ms de pausa entre cada um). Se a nossa linha ainda nao existe
    // quando o eco chega, o social-webhook nao reconhece que a mensagem e
    // nossa, grava como 'agent' e manda a conversa para 'human' — e o bot se
    // cala no meio do atendimento, sem erro em lugar nenhum.
    //
    // Depois disso o insert em lote do fim batia no indice unico de
    // wa_message_id, falhava inteiro, e ninguem via porque o erro nao era
    // conferido. Sobrava so a linha do eco, marcada como atendente.
    const ultimo = enviados[enviados.length - 1];
    await gravarBalao(ultimo);
  }

  sent = enviados.some((e) => e.ok);

  if (sent) {
    log.info('resposta enviada', { action: 'send_final', canal, chars: finalText.length, baloes: baloes.length });
  } else {
    log.error('falha ao enviar — mensagem salva no banco mesmo assim', { action: 'send_final', canal });
  }

  // ── 9. Atualiza last_message_at ───────────────────────────────────────────
  // As mensagens ja foram gravadas uma a uma, dentro do laco. O insert em lote
  // que existia aqui era o segundo meio do bug: alem de chegar tarde demais
  // para a trava do eco, ele batia no indice unico de wa_message_id quando o
  // eco tinha vencido a corrida, falhava INTEIRO e em silencio.
  const now = new Date().toISOString();
  await supabase.from('conversations').update({ last_message_at: now }).eq('id', conversationId);

  // Desfaz o "humano" que o nosso proprio eco possa ter causado.
  //
  // O bot so roda em conversa que NAO estava com humano, entao achar 'human'
  // agora significa que algo mudou durante o envio. Com `atendente` vazio, nao
  // foi gente assumindo: foi o eco de um balao nosso chegando antes da linha
  // existir. Sem esta correcao o bot ficaria mudo nas mensagens seguintes ate
  // o cron devolver-ao-bot reparar, e o cliente esperaria no vazio.
  //
  // So mexe quando atendente e nulo: vendedor que assumiu de verdade tem que
  // continuar com a conversa.
  const { data: depois } = await supabase
    .from('conversations')
    .select('status, atendente')
    .eq('id', conversationId)
    .maybeSingle();

  if (depois?.status === 'human' && !depois?.atendente) {
    await supabase.from('conversations').update({ status: 'bot' }).eq('id', conversationId);
    log.info('status devolvido ao bot: o eco do proprio envio tinha marcado como humano', {
      action: 'send_final', canal,
    });
  }

  // Libera a conversa DEPOIS de gravar as mensagens: se soltasse antes, a
  // rodada seguinte poderia montar o histórico sem o que acabamos de dizer e
  // repetir a resposta — o mesmo defeito por outro caminho.
  await liberarConversa();

  return new Response('OK', { status: 200 });
}));
