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
    const chave      = Deno.env.get('ASAAS_API_KEY') ?? '';

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

    const { data: loja, error: erroLoja } = await admin
      .from('company_settings')
      .select('company_name, cnpj, phone_number, billing_amount, asaas_customer_id, assinatura_status')
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
    const padrao = Number(Deno.env.get('ASSINATURA_VALOR_PADRAO') ?? '');
    const valor = Number(loja?.billing_amount) || (Number.isFinite(padrao) && padrao > 0 ? padrao : 0);
    if (!valor) {
      return json({
        error: 'Seu plano ainda está sendo configurado. Assim que combinarmos o valor, a assinatura aparece aqui para você ativar.',
        aguardando_plano: true,
      }, 409);
    }

    const { url: api, ambiente } = baseDoAsaas(chave);
    const cabecalhos = { 'Content-Type': 'application/json', access_token: chave };

    // ── 1. Cliente no Asaas ──────────────────────────────────────────────────
    // Reaproveita se já existe: criar de novo a cada tentativa encheria a conta
    // deles de clientes duplicados para a mesma loja.
    let customerId = loja?.asaas_customer_id ?? '';
    if (!customerId) {
      const documento = String(loja?.cnpj ?? '').replace(/\D/g, '');
      if (!documento) {
        return json({
          error: 'Antes de assinar, preencha o CNPJ da loja em Configurações — o Asaas exige o documento do titular.',
        }, 400);
      }

      const resCliente = await fetch(`${api}/customers`, {
        method: 'POST',
        headers: cabecalhos,
        body: JSON.stringify({
          name: loja?.company_name || user.email,
          email: user.email,
          cpfCnpj: documento,
          mobilePhone: String(loja?.phone_number ?? '').replace(/\D/g, '') || undefined,
          // Amarra o cliente lá ao usuário daqui. Serve de rede de segurança se
          // algum dia o id se perder.
          externalReference: user.id,
        }),
      });
      if (!resCliente.ok) return json({ error: await erroDoAsaas(resCliente) }, 502);

      const cliente = await resCliente.json();
      customerId = String(cliente?.id ?? '');
      if (!customerId) return json({ error: 'O Asaas não devolveu o id do cliente.' }, 502);

      await admin.from('company_settings')
        .update({ asaas_customer_id: customerId, assinatura_atualizada_em: new Date().toISOString() })
        .eq('user_id', user.id);
    }

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
        // `customer` e `customerData` são excludentes: mandar os dois é erro.
        customer: customerId,
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

    console.log('[assinatura] checkout criado', { ambiente, user: user.id, valor, checkout: checkout?.id });
    return json({ link, valor, ambiente });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[assinatura] exceção:', msg);
    return json({ error: msg }, 500);
  }
});
