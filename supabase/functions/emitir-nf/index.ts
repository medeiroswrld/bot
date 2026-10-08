import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildCors } from '../_shared/cors.ts';

// Emissão de NF-e pela venda de um veículo.
//
// ── O que esta função faz, e o que ela recusa a fazer ──────────────────────
//
// Ela monta os dados da venda e transmite ao provedor, que assina com o
// certificado A1 da loja e fala com a SEFAZ. Ela NÃO decide imposto: CFOP e
// regime vêm configurados pelo contador da loja e são enviados como estão.
//
// Isso não é preguiça de desenho. Veículo usado é tributado sobre a MARGEM, com
// regra que muda por estado e por regime, e errar a base de cálculo gera
// autuação no cliente — não um bug que a gente corrige na segunda-feira.
//
// ── Por que ela trava quando falta dado ────────────────────────────────────
//
// Nota fiscal não aceita "mais ou menos". Faltando CNPJ, inscrição estadual,
// CPF do comprador ou preço de compra, ela devolve a lista exata do que falta
// em vez de transmitir e deixar a SEFAZ rejeitar — rejeição chega como código
// numérico, às vezes horas depois, com o cliente esperando para levar o carro.
//
// ── Idempotência não é detalhe ─────────────────────────────────────────────
//
// A `ref` enviada ao provedor é derivada do id do veículo. Reenviar a mesma ref
// não emite outra nota. Sem isso, um duplo clique viraria duas notas fiscais da
// mesma venda — e isso só se resolve com cancelamento, prazo de 24h e uma
// conversa com o contador.

const FOCUS = {
  producao:    'https://api.focusnfe.com.br/v2/nfe',
  homologacao: 'https://homologacao.focusnfe.com.br/v2/nfe',
};

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

Deno.serve(async (req) => {
  const CORS = buildCors(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  try {
    if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authorization ausente' }, 401);

    const url        = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const userClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user }, error: userErr } =
      await userClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userErr || !user) return json({ error: 'Não autenticado' }, 401);

    let body: { car_id?: string };
    try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const carId = String(body?.car_id ?? '').trim();
    if (!carId) return json({ error: 'car_id ausente.' }, 400);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // O veículo é buscado com o user_id do JWT: sem isso, qualquer usuário
    // logado emitiria nota de uma venda de outra loja.
    const { data: carro } = await admin
      .from('cars')
      .select('id, brand, model, version, year, model_year, chassi, renavam, plate, color, '
            + 'sold_price, price, purchase_price, sold_at, '
            + 'buyer_name, buyer_cpf, buyer_address, buyer_phone, buyer_email')
      .eq('id', carId).eq('user_id', user.id).maybeSingle();

    if (!carro)             return json({ error: 'Veículo não encontrado nesta conta.' }, 404);
    if (!carro.sold_at)     return json({ error: 'Este veículo ainda não está marcado como vendido.' }, 400);

    const { data: loja } = await admin
      .from('company_settings')
      .select('company_name, cnpj, address, phone_number, inscricao_estadual, '
            + 'nf_ativo, nf_ambiente, nf_serie, nf_cfop, nf_provedor, nf_token_set')
      .eq('user_id', user.id).maybeSingle();

    if (!loja?.nf_ativo) {
      return json({ error: 'A emissão de nota fiscal não está ativada para esta loja.' }, 400);
    }

    // ── Tudo que falta, de uma vez ───────────────────────────────────────────
    // Uma lista só. Devolver um erro por vez faria o lojista descobrir os seis
    // problemas em seis tentativas, cada uma com o cliente esperando.
    const falta: string[] = [];
    if (!soDigitos(loja.cnpj))                   falta.push('CNPJ da loja (Configurações)');
    if (!String(loja.inscricao_estadual ?? ''))  falta.push('Inscrição Estadual da loja');
    if (!String(loja.address ?? ''))             falta.push('Endereço da loja');
    if (!loja.nf_serie)                          falta.push('Série da nota (Configurações)');
    if (!String(loja.nf_cfop ?? ''))             falta.push('CFOP (peça ao seu contador)');
    if (!loja.nf_token_set)                      falta.push('Token do provedor de NF-e');
    if (!String(carro.buyer_name ?? ''))         falta.push('Nome do comprador');
    if (soDigitos(carro.buyer_cpf).length < 11)  falta.push('CPF ou CNPJ do comprador');
    if (!String(carro.buyer_address ?? ''))      falta.push('Endereço do comprador');
    if (!carro.chassi)                           falta.push('Chassi do veículo');

    // O preço de compra define a MARGEM, que é sobre o que o imposto de usado
    // incide. Emitir sem ele é emitir com base de cálculo errada.
    if (carro.purchase_price == null || Number(carro.purchase_price) <= 0) {
      falta.push('Preço de compra do veículo (a margem é a base do imposto)');
    }

    const valor = Number(carro.sold_price ?? carro.price ?? 0);
    if (!valor) falta.push('Valor da venda');

    if (falta.length) {
      return json({
        error: 'Faltam dados obrigatórios para emitir a nota.',
        falta,
      }, 422);
    }

    const { data: token } = await admin.rpc('get_nf_token', { p_user_id: user.id });
    if (!token) return json({ error: 'Token do provedor não encontrado.' }, 400);

    const ambiente = loja.nf_ambiente === 'producao' ? 'producao' : 'homologacao';
    const ref = `amply-${carro.id}`;

    // Já emitida? Devolve a que existe em vez de tentar de novo.
    const { data: existente } = await admin
      .from('notas_fiscais').select('*')
      .eq('user_id', user.id).eq('ref', ref).maybeSingle();

    if (existente && existente.status === 'autorizada') {
      return json({ success: true, ja_emitida: true, nota: existente });
    }

    const descricao = [carro.brand, carro.model, carro.version, carro.year]
      .filter(Boolean).join(' ').trim();

    // O payload leva o CFOP CONFIGURADO pela loja. O sistema não escolhe
    // tributação — ele transmite o que o contador definiu.
    const payload = {
      natureza_operacao: 'Venda de mercadoria adquirida de terceiros',
      data_emissao: new Date().toISOString(),
      tipo_documento: 1,
      finalidade_emissao: 1,
      consumidor_final: 1,
      presenca_comprador: 1,

      cnpj_emitente: soDigitos(loja.cnpj),
      nome_emitente: loja.company_name,
      inscricao_estadual_emitente: soDigitos(loja.inscricao_estadual),

      nome_destinatario: carro.buyer_name,
      [soDigitos(carro.buyer_cpf).length > 11 ? 'cnpj_destinatario' : 'cpf_destinatario']:
        soDigitos(carro.buyer_cpf),
      logradouro_destinatario: carro.buyer_address,
      telefone_destinatario: soDigitos(carro.buyer_phone) || undefined,
      email_destinatario: carro.buyer_email || undefined,

      serie: loja.nf_serie,

      items: [{
        numero_item: 1,
        codigo_produto: carro.chassi,
        descricao: `${descricao} — Chassi ${carro.chassi}`
                 + (carro.plate ? ` — Placa ${carro.plate}` : ''),
        cfop: loja.nf_cfop,
        unidade_comercial: 'UN',
        quantidade_comercial: 1,
        valor_unitario_comercial: valor,
        valor_bruto: valor,
        unidade_tributavel: 'UN',
        quantidade_tributavel: 1,
        valor_unitario_tributavel: valor,
      }],
    };

    const res = await fetch(
      `${FOCUS[ambiente]}?ref=${encodeURIComponent(ref)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Focus usa Basic com o token no usuário e senha vazia.
          Authorization: `Basic ${btoa(`${token}:`)}`,
        },
        body: JSON.stringify(payload),
      },
    );

    const corpo = await res.text();
    let resposta: Record<string, unknown> = {};
    try { resposta = JSON.parse(corpo); } catch { /* fica o texto cru no erro */ }

    const deuCerto = res.ok || res.status === 202;
    const registro = {
      user_id: user.id,
      car_id: carro.id,
      ref,
      status: deuCerto ? String(resposta.status ?? 'processando') : 'erro',
      numero: resposta.numero ? String(resposta.numero) : null,
      serie: loja.nf_serie,
      chave: resposta.chave_nfe ? String(resposta.chave_nfe) : null,
      valor,
      xml_url: resposta.caminho_xml_nota_fiscal ? String(resposta.caminho_xml_nota_fiscal) : null,
      danfe_url: resposta.caminho_danfe ? String(resposta.caminho_danfe) : null,
      erro: deuCerto ? null
        : String(resposta.mensagem ?? resposta.erros ?? corpo).slice(0, 500),
      ambiente,
      updated_at: new Date().toISOString(),
    };

    await admin.from('notas_fiscais')
      .upsert(registro, { onConflict: 'user_id,ref' });

    if (!deuCerto) {
      console.error('[emitir-nf] provedor recusou:', corpo.slice(0, 300));
      return json({ error: registro.erro, nota: registro }, 502);
    }

    // A SEFAZ responde em segundos ou minutos. A nota nasce "processando" e a
    // consulta a atualiza — prender a tela esperando seria pedir ao lojista que
    // olhasse para uma ampulheta por tempo indeterminado.
    return json({ success: true, nota: registro });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[emitir-nf] exceção:', msg);
    return json({ error: msg }, 500);
  }
});
