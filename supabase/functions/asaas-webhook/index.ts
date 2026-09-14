// asaas-webhook — é aqui que o pagamento vira acesso.
//
// O checkout devolve o cliente pro site com uma URL de sucesso, e essa URL NÃO
// serve pra liberar nada: a própria documentação do Asaas avisa que o callback
// é redirecionamento, não confirmação. Quem confirma é este webhook, que fala
// direto com o Asaas sem passar pelo navegador de ninguém.
//
// ── Três regras que este arquivo segue sem exceção ──────────────────────────
//
// 1. RESPONDE 200 MESMO QUANDO DÁ ERRADO POR DENTRO.
//    O Asaas interrompe a fila de sincronização depois de 15 falhas seguidas, e
//    a fila só volta com alguém reativando à mão no painel. Ou seja: um bug
//    nosso devolvendo 500 pararia de receber TODOS os pagamentos, de TODOS os
//    clientes, em silêncio, até alguém perceber. Erro nosso vira log, não 500.
//
// 2. É IDEMPOTENTE PELO ID DO EVENTO.
//    O Asaas reenvia quando não recebe sucesso. Sem trava, um pagamento reenviado
//    vira dois. A chave primária de `asaas_eventos` faz esse trabalho.
//
// 3. IGNORA CAMPO DESCONHECIDO.
//    Eles avisam que acrescentam atributos aos webhooks com o tempo. Código que
//    explode com campo novo quebra na primeira mudança deles.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ok = (corpo: Record<string, unknown> = { ok: true }) =>
  new Response(JSON.stringify(corpo), { status: 200, headers: { 'Content-Type': 'application/json' } });

/**
 * De evento do Asaas para estado da conta.
 *
 * `PAYMENT_CONFIRMED` é o que libera, e não `PAYMENT_RECEIVED`: no cartão, o
 * fluxo é CREATED → CONFIRMED → RECEIVED, e o RECEIVED só chega 32 DIAS depois,
 * quando o dinheiro é liberado. Esperar por ele deixaria o lojista pago e sem
 * sistema por um mês.
 */
function estadoDoEvento(evento: string): string | null {
  // Pagou.
  if (evento === 'PAYMENT_CONFIRMED' || evento === 'PAYMENT_RECEIVED') return 'ativa';

  // Não pagou — e a renovação recusada é o caso mais comum de todos.
  //
  // Assinatura raramente morre porque alguém cancelou; ela morre porque o
  // cartão venceu, estourou o limite ou foi trocado e ninguém avisou. Sem
  // tratar CAPTURE_REFUSED, uma conta assim continuaria marcada como 'ativa'
  // para sempre, usando o sistema de graça enquanto o Asaas tenta cobrar.
  if (evento === 'PAYMENT_OVERDUE') return 'atrasada';
  if (evento === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED') return 'atrasada';
  if (evento === 'PAYMENT_REPROVED_BY_RISK_ANALYSIS') return 'atrasada';

  // Acabou.
  if (evento === 'PAYMENT_REFUNDED') return 'cancelada';
  if (evento === 'PAYMENT_CHARGEBACK_REQUESTED') return 'cancelada';
  if (evento === 'PAYMENT_DELETED') return 'cancelada';

  // A assinatura inteira acabou, e nao so uma cobranca dela. Sem isto, uma
  // assinatura removida no painel do Asaas pararia de gerar cobranca e a conta
  // ficaria 'ativa' para sempre — ninguem cobra, ninguem corta.
  if (evento === 'SUBSCRIPTION_DELETED') return 'cancelada';
  if (evento === 'SUBSCRIPTION_INACTIVATED') return 'cancelada';

  // Tudo o mais (PAYMENT_CREATED, PAYMENT_UPDATED, análise de risco em
  // andamento, eventos de boleto e split) fica gravado no histórico e não mexe
  // no acesso. Em especial AWAITING_RISK_ANALYSIS é espera, não recusa:
  // derrubar a conta ali cortaria quem ainda pode ser aprovado em seguida.
  return null;
}

Deno.serve(async (req) => {
  // Validação de quem chamou. O Asaas manda o token no header `asaas-access-token`.
  //
  // Aqui SIM vale recusar: requisição sem token não é o Asaas, e devolver 401
  // pra um desconhecido não afeta a fila deles.
  const esperado = Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? '';
  const recebido = req.headers.get('asaas-access-token') ?? '';
  if (!esperado || recebido !== esperado) {
    console.warn('[asaas] requisição recusada: token ausente ou diferente');
    return new Response(JSON.stringify({ error: 'nao autorizado' }), { status: 401 });
  }

  let corpo: Record<string, unknown> = {};
  try {
    corpo = await req.json();
  } catch {
    console.warn('[asaas] corpo ilegível');
    return ok({ ignorado: 'corpo ilegivel' });
  }

  const eventoId = String(corpo?.id ?? '');
  const evento   = String(corpo?.event ?? '');
  // Evento de cobranca traz `payment`; evento de assinatura traz `subscription`.
  // Sem ler os dois, SUBSCRIPTION_DELETED chegaria sem dono e seria descartado.
  const pagamento  = (corpo?.payment ?? {}) as Record<string, unknown>;
  const assinatura = (corpo?.subscription ?? {}) as Record<string, unknown>;

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // ── Trava de reenvio ─────────────────────────────────────────────────────
    // Sem `id` não dá pra deduplicar; nesse caso processa mesmo assim, porque
    // perder um pagamento é pior que processar duas vezes um evento raro.
    if (eventoId) {
      const { error: erroInsert } = await admin
        .from('asaas_eventos')
        .insert({
          id: eventoId,
          tipo: evento,
          payment_id: pagamento?.id ?? null,
          subscription_id: pagamento?.subscription ?? assinatura?.id ?? null,
          payload: corpo,
        });

      // 23505 = chave duplicada, ou seja, já processamos. Não é erro.
      if (erroInsert && (erroInsert as { code?: string }).code === '23505') {
        console.log('[asaas] evento repetido, ignorando', eventoId);
        return ok({ repetido: true });
      }
      if (erroInsert) console.error('[asaas] não consegui gravar o evento:', erroInsert.message);
    }

    const novoEstado = estadoDoEvento(evento);
    if (!novoEstado) {
      console.log('[asaas] evento sem efeito no acesso:', evento);
      return ok({ registrado: true });
    }

    // ── Achar a loja ─────────────────────────────────────────────────────────
    // Primeiro pelo `externalReference`, que carregamos com o user_id na criação
    // do checkout. O id do cliente é o caminho alternativo, pra quando o evento
    // vier de uma cobrança criada fora deste fluxo.
    const referencia = String(
      pagamento?.externalReference ?? assinatura?.externalReference ?? corpo?.externalReference ?? '',
    );
    const clienteAsaas = String(pagamento?.customer ?? assinatura?.customer ?? '');

    let userId = '';
    if (referencia) {
      const { data } = await admin.from('company_settings')
        .select('user_id').eq('user_id', referencia).maybeSingle();
      if (data?.user_id) userId = data.user_id;
    }
    if (!userId && clienteAsaas) {
      const { data } = await admin.from('company_settings')
        .select('user_id').eq('asaas_customer_id', clienteAsaas).maybeSingle();
      if (data?.user_id) userId = data.user_id;
    }

    if (!userId) {
      // Pagamento sem dono conhecido. Fica registrado em `asaas_eventos` pra
      // alguém investigar — e o 200 evita que isso derrube a fila inteira.
      console.error('[asaas] não achei a loja', { evento, referencia, clienteAsaas });
      return ok({ registrado: true, sem_loja: true });
    }

    const agora = new Date().toISOString();
    const atualizacao: Record<string, unknown> = {
      assinatura_status: novoEstado,
      assinatura_atualizada_em: agora,
    };
    const idAssinatura = pagamento?.subscription ?? assinatura?.id;
    if (idAssinatura) atualizacao.asaas_subscription_id = idAssinatura;
    if (clienteAsaas)            atualizacao.asaas_customer_id     = clienteAsaas;
    if (novoEstado === 'ativa')  atualizacao.ultimo_pagamento_em   = agora;
    if (pagamento?.dueDate)      atualizacao.proximo_vencimento    = pagamento.dueDate;

    const { error: erroUpdate } = await admin
      .from('company_settings').update(atualizacao).eq('user_id', userId);
    if (erroUpdate) {
      console.error('[asaas] falha ao atualizar a loja:', erroUpdate.message);
      return ok({ registrado: true, erro_interno: true });
    }

    await admin.from('asaas_eventos').update({ user_id: userId }).eq('id', eventoId);

    console.log('[asaas] conta atualizada', { evento, userId, estado: novoEstado });
    return ok({ ok: true, estado: novoEstado });

  } catch (e) {
    // Última linha de defesa: qualquer exceção ainda devolve 200, pelo motivo
    // explicado no topo. O que se perde é um evento; o que se evita é a fila
    // parar pra todos os clientes.
    console.error('[asaas] exceção:', e instanceof Error ? e.message : String(e));
    return ok({ erro_interno: true });
  }
});
