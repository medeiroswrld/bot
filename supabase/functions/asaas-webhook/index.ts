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
  // Dois tokens aceitos ao mesmo tempo, um por ambiente.
  //
  // Diferente da chave de API — onde escolhemos UMA e a de sandbox tem
  // prioridade — aqui o webhook RECEBE dos dois lados. Aceitar os dois deixa
  // produção e sandbox rodando em paralelo, sem precisar mexer no webhook de
  // produção que já está configurado e funcionando.
  //
  // Saber QUAL bateu não é enfeite: é o que diz, no log, se um pagamento veio
  // de teste ou de dinheiro de verdade.
  const recebido = req.headers.get('asaas-access-token') ?? '';
  const tokens: Array<[string, string]> = [
    ['producao', Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? ''],
    ['sandbox',  Deno.env.get('ASAAS_WEBHOOK_TOKEN_SANDBOX') ?? ''],
  ];
  const origem = tokens.find(([, t]) => t && t === recebido)?.[0];

  if (!origem) {
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
      console.log('[asaas] evento sem efeito no acesso:', evento, `(${origem})`);
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

    // A sessão de checkout vem primeiro porque é a única ponta confiável no
    // PRIMEIRO pagamento: o externalReference chega null e o cliente só passa a
    // existir depois que o pagador preenche o formulário.
    const sessao = String(pagamento?.checkoutSession ?? '');
    if (sessao) {
      const { data } = await admin.from('company_settings')
        .select('user_id').eq('asaas_checkout_id', sessao).maybeSingle();
      if (data?.user_id) userId = data.user_id;
    }

    if (!userId && referencia) {
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

    // ── A escolha do plano vira plano aqui, e so aqui ────────────────────────
    //
    // `assinatura-criar` grava a escolha em `plano_pretendido` e nao toca em
    // `plano`. Quem promove e o pagamento confirmado — este evento.
    //
    // E dividido assim porque antes a escolha era gravada no clique: quem
    // abria o checkout e desistia ficava marcado com um plano que nunca
    // comprou, e a tela passava a cobrar aquele valor. Com a promocao aqui,
    // `plano` significa uma coisa so: o que a loja esta pagando.
    //
    // `billing_amount` vem da tabela `planos`, nao do evento do Asaas. O valor
    // do Asaas e o que foi cobrado AGORA, que pode ser proporcional ou de uma
    // promocao; o que a tela mostra como mensalidade tem que ser o preco do
    // plano. Se o pretendido nao existir mais na tabela, nada e promovido e o
    // `billing_amount` negociado pelo administrador fica de pe.
    if (novoEstado === 'ativa') {
      const { data: pendente } = await admin
        .from('company_settings')
        .select('plano_pretendido')
        .eq('user_id', userId)
        .maybeSingle();

      if (pendente?.plano_pretendido) {
        const { data: plano } = await admin
          .from('planos')
          .select('slug, preco, inclui_bot, inclui_disparos')
          .eq('slug', pendente.plano_pretendido)
          .maybeSingle();

        if (plano?.preco != null) {
          atualizacao.plano            = plano.slug;
          atualizacao.billing_amount   = Number(plano.preco);
          atualizacao.plano_pretendido = null;

          // ── Pagar tem que LIGAR o bot ────────────────────────────────────
          //
          // `bot_contratado` nasce `false` (migration 070), de quando o bot era
          // liberado a mao pelo administrador ao fechar a venda. Ninguem
          // reconectou essa ponta quando o pagamento por cartao passou a
          // existir: a assinatura virava 'ativa' e o bot continuava desligado.
          // O lojista pagaria a mensalidade e ficaria sem atendimento
          // automatico ate alguem reparar no painel.
          //
          // Nunca aconteceu porque todo cliente de hoje foi ligado a mao antes
          // da cobranca existir — o primeiro a pagar pelo cartao e que
          // descobriria, e da pior forma.
          //
          // Vem de `inclui_bot`, e nao um `true` fixo: o plano CRM existe e NAO
          // tem bot. Fixar aqui entregaria de graca o que separa ele dos outros
          // — e fecharia o caminho de volta para quem desce de plano.
          atualizacao.bot_contratado = plano.inclui_bot === true;

          // Disparo fica FORA do teste (migration 107): custa template a Meta,
          // e iniciado pelo lojista e escala com um clique — o unico pedaco do
          // produto onde um cadastro gratis gasta dinheiro nosso sem ninguem do
          // outro lado ter pedido nada. Entao e o pagamento que liga, aqui.
          //
          // Coluna propria em `planos`, e nao `inclui_bot` reaproveitado: a 071
          // separou os dois de proposito porque a venda pede CRM + disparo sem
          // bot. Hoje nenhum plano usa essa combinacao; amarrar aqui quebraria
          // calado no dia em que usar.
          atualizacao.disparos_contratado = plano.inclui_disparos === true;

          console.log('[asaas] plano promovido pelo pagamento', {
            userId, plano: plano.slug,
            bot: plano.inclui_bot === true,
            disparos: plano.inclui_disparos === true,
          });
        } else {
          console.error('[asaas] plano pretendido nao existe mais na tabela', {
            userId, pretendido: pendente.plano_pretendido,
          });
        }
      }
    }

    const { error: erroUpdate } = await admin
      .from('company_settings').update(atualizacao).eq('user_id', userId);
    if (erroUpdate) {
      console.error('[asaas] falha ao atualizar a loja:', erroUpdate.message);
      return ok({ registrado: true, erro_interno: true });
    }

    await admin.from('asaas_eventos').update({ user_id: userId }).eq('id', eventoId);

    console.log('[asaas] conta atualizada', { origem, evento, userId, estado: novoEstado });
    return ok({ ok: true, estado: novoEstado });

  } catch (e) {
    // Última linha de defesa: qualquer exceção ainda devolve 200, pelo motivo
    // explicado no topo. O que se perde é um evento; o que se evita é a fila
    // parar pra todos os clientes.
    console.error('[asaas] exceção:', e instanceof Error ? e.message : String(e));
    return ok({ erro_interno: true });
  }
});
