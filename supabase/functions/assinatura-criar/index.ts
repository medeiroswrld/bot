// assinatura-criar — devolve o link do Checkout do Asaas para o lojista pagar.
//
// ── Por que Checkout hospedado, e não a API de cartão ───────────────────────
//
// O Asaas tem dois caminhos. Na API de tokenização, o número do cartão vai do
// navegador pro nosso servidor e de lá pra eles — o que coloca o Amply dentro
// do escopo PCI-DSS, com auditoria e responsabilidade se vazar. No Checkout, o
// cliente digita o cartão numa página do próprio Asaas, que é instituição de
// pagamento autorizada pelo BC e certificada PCI.
//
// Esta função, portanto, NUNCA vê um número de cartão. Ela cria o cliente e a
// sessão de checkout, e devolve uma URL.
//
// ── O que ela NÃO faz ───────────────────────────────────────────────────────
//
// Não libera acesso. Quem libera é o webhook, quando o Asaas confirma o
// pagamento. As URLs de callback abaixo só mandam o navegador de volta — a
// própria documentação avisa que elas não servem pra confirmar pagamento, e
// confiar nelas seria liberar o sistema pra quem sabe montar uma URL.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

/**
 * Sandbox ou produção, decidido pela PRÓPRIA CHAVE.
 *
 * As chaves de homologação do Asaas carregam `hmlg` no prefixo. Derivar daqui
 * elimina a classe de erro mais boba e mais cara desse tipo de integração:
 * chave de sandbox apontando pra produção, ou pior, o contrário.
 */
function baseDoAsaas(chave: string): { url: string; ambiente: string } {
  const homologacao = chave.includes('hmlg');
  return {
    url: homologacao ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3',
    ambiente: homologacao ? 'sandbox' : 'producao',
  };
}

/** A mensagem de erro do Asaas vem em `errors[].description`. */
async function erroDoAsaas(res: Response): Promise<string> {
  try {
    const corpo = await res.json();
    const lista = (corpo?.errors ?? []) as Array<{ description?: string }>;
    const desc = lista.map((e) => e.description).filter(Boolean).join('; ');
    return desc || `O Asaas respondeu ${res.status}.`;
  } catch {
    return `O Asaas respondeu ${res.status}.`;
  }
}

/** Data de hoje em São Paulo, no formato que o Asaas espera. */
function hojeEmSaoPaulo(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authorization ausente' }, 401);

    const url        = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    // Duas chaves, uma regra: se a de sandbox existir, ela ganha.
    //
    // Assim a chave de produção fica guardada e intocada enquanto se testa, e
    // ir pra produção é APAGAR o secret de sandbox — não é lembrar de colar a
    // chave certa de volta, que é o tipo de passo manual que um dia falha.
    //
    // O contrário também vale: enquanto o secret de sandbox existir, é
    // impossível cobrar de verdade sem querer.
    const chaveSandbox = Deno.env.get('ASAAS_API_KEY_SANDBOX') ?? '';
    const chave = chaveSandbox || (Deno.env.get('ASAAS_API_KEY') ?? '');

    if (!chave) {
      return json({ error: 'Cobrança não configurada: falta o secret ASAAS_API_KEY.' }, 501);
    }

    // Quem está pedindo — validado no servidor de auth, nunca vindo do corpo.
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: erroUser } = await userClient.auth.getUser();
    if (erroUser || !user) return json({ error: 'Não autenticado' }, 401);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // O cliente pode escolher a propria faixa na tela de planos.
    //
    // Isso NAO contradiz a trava do banco, que impede o lojista de mudar
    // `plano` pela API. A diferenca e quem escreve: la e o navegador dele; aqui
    // e o servidor, depois de ler o preco da tabela `planos`. Ele escolhe o
    // rotulo; o valor vem de um lugar que ele nao alcanca.
    let escolhido = '';
    try {
      const corpo = await req.json();
      escolhido = String((corpo as { plano?: string })?.plano ?? '').trim();
    } catch { /* sem corpo: mantem o plano que ja estiver na loja */ }

    const { data: loja, error: erroLoja } = await admin
      .from('company_settings')
      .select('company_name, billing_amount, assinatura_status')
      .eq('user_id', user.id)
      .maybeSingle();
    if (erroLoja) return json({ error: `Não consegui ler os dados da loja: ${erroLoja.message}` }, 500);

    if (loja?.assinatura_status === 'isento') {
      return json({ error: 'Esta conta é cobrada por fora e não precisa de assinatura no cartão.' }, 409);
    }

    // O valor NUNCA é inventado aqui.
    //
    // O preço do Amply é NEGOCIADO loja a loja — não existe tabela. Quem manda
    // é o `billing_amount`, que o administrador define no painel ao fechar a
    // venda. O secret ASSINATURA_VALOR_PADRAO é só uma rede de segurança, para
    // o dia em que existir um plano de entrada com preço fixo; enquanto não
    // existir, ele fica vazio e nunca é usado.
    //
    // Sem preço definido a função NÃO cobra um número chutado. E a mensagem é
    // escrita para o LOJISTA, não para o desenvolvedor: quem vai ler isso é o
    // dono de uma revenda que acabou de se cadastrar, e "configure o secret"
    // não significa nada pra ele.
    // Plano escolhido agora tem prioridade sobre o que estava gravado.
    let valorDoPlano = 0;
    if (escolhido) {
      const { data: p } = await admin
        .from('planos').select('slug, nome, preco').eq('slug', escolhido).maybeSingle();

      if (!p) return json({ error: 'Plano desconhecido.' }, 400);

      // 'personalizado' nao tem preco de tabela: e conversa comercial, nao
      // botao de pagar. Deixar passar geraria cobranca de valor nenhum.
      if (p.preco === null || p.preco === undefined) {
        return json({
          error: 'Esse plano é combinado direto com a gente. Fale com o suporte para fecharmos o valor.',
        }, 409);
      }

      valorDoPlano = Number(p.preco);
      await admin.from('company_settings')
        .update({ plano: p.slug, billing_amount: valorDoPlano })
        .eq('user_id', user.id);
      console.log('[assinatura] plano escolhido pelo lojista', { user: user.id, plano: p.slug });
    }

    const padrao = Number(Deno.env.get('ASSINATURA_VALOR_PADRAO') ?? '');
    const valor = valorDoPlano || Number(loja?.billing_amount) || (Number.isFinite(padrao) && padrao > 0 ? padrao : 0);
    if (!valor) {
      return json({
        error: 'Seu plano ainda está sendo configurado. Assim que combinarmos o valor, a assinatura aparece aqui para você ativar.',
        aguardando_plano: true,
      }, 409);
    }

    const { url: api, ambiente } = baseDoAsaas(chave);
    const cabecalhos = { 'Content-Type': 'application/json', access_token: chave };

    // ── Por que NÃO criamos o cliente no Asaas antes ─────────────────────────
    //
    // A primeira versão criava o cliente e passava o id em `customer`. O Asaas
    // recusou:
    //
    //   "O campo address deve existir para o customer informado"
    //   (e addressNumber, postalCode, province, city)
    //
    // Cobrança em cartão exige endereço completo e estruturado do titular, por
    // antifraude. Nós guardamos endereço num campo de TEXTO LIVRE, usado no
    // contrato — quebrar aquilo em logradouro, número, CEP, bairro e cidade
    // seria adivinhação, e adivinhar aqui vira cobrança recusada no cartão de
    // um cliente pagante.
    //
    // Então quem coleta é o próprio Checkout, que já valida esses campos e é a
    // razão de existir de uma página hospedada. O vínculo com a loja daqui não
    // depende disso: vai no `externalReference`, e o webhook guarda o id do
    // cliente quando o Asaas o cria.

    // ── 2. Sessão de checkout ────────────────────────────────────────────────
    const origem = req.headers.get('origin') || 'https://amply.ia.br';
    const resCheckout = await fetch(`${api}/checkouts`, {
      method: 'POST',
      headers: cabecalhos,
      body: JSON.stringify({
        billingTypes: ['CREDIT_CARD'],
        chargeTypes: ['RECURRENT'],
        // Entre 10 e 1440. Uma hora é tempo de sobra pra digitar um cartão e
        // curto o bastante pra um link vazado não valer pra sempre.
        minutesToExpire: 60,
        externalReference: user.id,
        callback: {
          successUrl: `${origem}/?assinatura=ok`,
          cancelUrl:  `${origem}/?assinatura=cancelada`,
          expiredUrl: `${origem}/?assinatura=expirada`,
        },
        items: [{
          name: 'Amply — assinatura mensal',
          description: 'CRM, atendimento automático e disparos',
          quantity: 1,
          value: valor,
        }],
        subscription: {
          cycle: 'MONTHLY',
          // Hoje: a primeira cobrança sai na conclusão do checkout, que é o que
          // "só roda depois de pago" significa.
          nextDueDate: hojeEmSaoPaulo(),
        },
      }),
    });
    if (!resCheckout.ok) return json({ error: await erroDoAsaas(resCheckout) }, 502);

    const checkout = await resCheckout.json();
    const link = checkout?.link ?? checkout?.url ?? '';
    if (!link) return json({ error: 'O Asaas não devolveu o link do checkout.' }, 502);

    // Guardar o id do checkout é o que permite reconhecer o PRIMEIRO pagamento.
    // O `externalReference` não desce do checkout pro pagamento, e o id do
    // cliente só nasce quando o pagador preenche os dados — então esta é a
    // única ponta que existe dos dois lados antes de alguém pagar.
    if (checkout?.id) {
      await admin.from('company_settings')
        .update({ asaas_checkout_id: checkout.id, assinatura_atualizada_em: new Date().toISOString() })
        .eq('user_id', user.id);
    }

    console.log(
      ambiente === 'producao'
        ? '[assinatura] ATENCAO: checkout de PRODUCAO (cobranca real)'
        : '[assinatura] checkout de sandbox (sem dinheiro real)',
      { ambiente, user: user.id, valor, checkout: checkout?.id },
    );
    return json({ link, valor, ambiente });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[assinatura] exceção:', msg);
    return json({ error: msg }, 500);
  }
});
