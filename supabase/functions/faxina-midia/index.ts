// faxina-midia — apaga mídia que não serve mais a ninguém.
//
// ── Por que existe ────────────────────────────────────────────────────────
//
// Em 2026-10-14 o projeto caiu. A causa raiz não foi técnica: o storage
// passou de 1 GB para 2,9 GB no plano gratuito, isso virou fatura, a fatura
// não foi vista e o projeto foi pausado.
//
// E o crescimento não tinha freio. Toda foto que um cliente manda numa
// conversa fica guardada para sempre; toda foto de carro continua ocupando
// espaço anos depois de o carro ter sido vendido. Com duas lojas já eram
// 2,9 GB. Com dez, seria quinze.
//
// ── Duas regras, dois relógios ────────────────────────────────────────────
//
//   carro vendido       → 20 dias depois da VENDA
//   mídia de conversa   → 20 dias depois da ÚLTIMA MENSAGEM
//
// Vinte dias, e não três, porque venda volta atrás. Três dias deixaria a loja
// sem as fotos de um carro que voltou para o pátio, e sem o registro visual
// de uma venda que virou discussão.
//
// ── O que isto NÃO apaga ──────────────────────────────────────────────────
//
// Nada do banco. O histórico de texto da conversa fica inteiro, o cadastro do
// veículo fica inteiro, o contrato fica inteiro. Some só o arquivo binário —
// e, no caso do carro, as linhas de `car_images` que apontavam para ele, para
// a tela não ficar com imagem quebrada.
//
// ── Por que apaga em lote e continua depois de falhar ─────────────────────
//
// Uma faxina que para no primeiro erro nunca termina, e aí o espaço volta a
// crescer sem ninguém perceber — que é exatamente o modo de falha que ela
// existe para evitar. Cada lote é independente e o que falhar fica para a
// próxima noite.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const DIAS = 20;
const LOTE = 100;   // teto do `remove` do Storage por chamada

Deno.serve(async () => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const resultado = { car_media: 0, chat_media: 0, erros: [] as string[] };

  /** Apaga em lotes. Um lote que falha não derruba os outros. */
  const apagar = async (bucket: string, nomes: string[]) => {
    let apagados = 0;
    for (let i = 0; i < nomes.length; i += LOTE) {
      const lote = nomes.slice(i, i + LOTE);
      const { error } = await supabase.storage.from(bucket).remove(lote);
      if (error) {
        console.error(`[faxina] lote falhou em ${bucket}:`, error.message);
        resultado.erros.push(`${bucket}: ${error.message}`);
        continue;
      }
      apagados += lote.length;
    }
    return apagados;
  };

  try {
    // ── 1. Mídia de carro vendido há mais de 20 dias ───────────────────────
    //
    // O caminho é `user_id/car_id/arquivo`, então a pasta do carro identifica
    // tudo dele de uma vez.
    const { data: vendidos, error: erroVendidos } = await supabase
      .from('cars')
      .select('id, user_id')
      .eq('status', 'sold')
      .lt('sold_at', new Date(Date.now() - DIAS * 864e5).toISOString());

    if (erroVendidos) throw new Error(`ler vendidos: ${erroVendidos.message}`);

    for (const carro of vendidos ?? []) {
      const prefixo = `${carro.user_id}/${carro.id}`;
      for (const bucket of ['car-images', 'car-videos']) {
        const { data: arquivos } = await supabase.storage.from(bucket).list(prefixo, { limit: 1000 });
        if (!arquivos?.length) continue;
        const nomes = arquivos.map((a) => `${prefixo}/${a.name}`);
        resultado.car_media += await apagar(bucket, nomes);
      }

      // As linhas que apontavam para arquivos que não existem mais sairiam
      // como imagem quebrada na tela de vendidos. Some o registro da foto, não
      // o do veículo.
      await supabase.from('car_images').delete().eq('car_id', carro.id);
    }

    // ── 2. Mídia de conversa parada há mais de 20 dias ─────────────────────
    //
    // O caminho é `user_id/conversation_id/arquivo`. A conversa continua
    // inteira no banco — some só o áudio e a foto que o cliente mandou, que
    // ninguém mais abre vinte dias depois.
    const { data: frias, error: erroFrias } = await supabase
      .from('conversations')
      .select('id, user_id')
      .lt('last_message_at', new Date(Date.now() - DIAS * 864e5).toISOString())
      .limit(500);

    if (erroFrias) throw new Error(`ler conversas frias: ${erroFrias.message}`);

    for (const conversa of frias ?? []) {
      const prefixo = `${conversa.user_id}/${conversa.id}`;
      const { data: arquivos } = await supabase.storage.from('chat-media').list(prefixo, { limit: 1000 });
      if (!arquivos?.length) continue;
      const nomes = arquivos.map((a) => `${prefixo}/${a.name}`);
      resultado.chat_media += await apagar('chat-media', nomes);
    }

    console.log('[faxina] concluída', resultado);
    return json(resultado);

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[faxina] exceção:', msg);
    return json({ ...resultado, erro: msg }, 500);
  }
});
