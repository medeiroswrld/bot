import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildCors } from '../_shared/cors.ts';

// Renova os tokens do Instagram antes deles morrerem.
//
// ── Por que isto existe ────────────────────────────────────────────────────
//
// Token longo do Instagram vale 60 DIAS. O do WhatsApp, vindo do Embedded
// Signup, não expira — e é justamente por isso que ninguém lembra que este
// expira. Quando vence, não chega erro em lugar nenhum: o Direct simplesmente
// para de responder, e a loja descobre pelo cliente reclamando.
//
// Roda uma vez por dia. A janela de 10 dias existe para caber tentativa
// repetida: se falhar hoje, ainda restam nove oportunidades antes de virar
// incidente. Renovar de véspera seria uma aposta.
//
// ── Por que não dá para fazer isto em SQL ──────────────────────────────────
//
// O `refresh_access_token` devolve o token NOVO no corpo da resposta. Chamado
// por `pg_net`, esse corpo ficaria gravado em texto puro em
// `net._http_response`, legível por qualquer um com acesso ao banco — trocar
// um token que vaza por outro que vaza. Aqui dentro ele nasce e morre na
// memória da função, e só sai cifrado para o Vault.
//
// ── Sobre autenticação de entrada ──────────────────────────────────────────
//
// Chamada pelo cron, sem cabeçalho de autorização, como as outras deste
// projeto. Aceitável AQUI especificamente porque a resposta não devolve
// material de token nenhum, a função só toca em quem já está perto de vencer,
// e a Meta recusa renovar token com menos de 24h de vida — então nem chamando
// em laço se consegue algo além de ruído no log.

const GRAPH = 'https://graph.instagram.com';

Deno.serve(async (req) => {
  const CORS = buildCors(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const url        = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Quem precisa. Duas situações, e a segunda é a que importa hoje:
  //
  //   validade conhecida e perto  -> renova
  //   validade DESCONHECIDA       -> renova também
  //
  // Validade nula é a conta conectada à mão, antes do botão existir. Não dá
  // para saber quando vence, e "não sei" não pode virar "deixa pra lá" — é
  // exatamente a conta que morre em silêncio. Renova uma vez, ganha data, e a
  // partir daí entra no fluxo normal.
  const { data: contas, error: buscaErr } = await admin
    .from('company_settings')
    .select('user_id, company_name, ig_user_id, ig_username, ig_token_expira_em')
    .not('ig_user_id', 'is', null);

  if (buscaErr) {
    console.error('[renovar-ig] falha ao listar contas:', buscaErr.message);
    return json({ error: buscaErr.message }, 500);
  }

  const limite = Date.now() + 10 * 24 * 3600 * 1000;
  const alvos = (contas ?? []).filter((c) => {
    if (!c.ig_token_expira_em) return true;
    return new Date(c.ig_token_expira_em).getTime() < limite;
  });

  const resultado: Array<{ loja: string; ok: boolean; detalhe: string }> = [];

  for (const conta of alvos) {
    const loja = conta.company_name || conta.user_id;
    try {
      const { data: atual, error: tokErr } = await admin.rpc('get_meta_page_token', {
        p_user_id: conta.user_id,
        p_canal:   'instagram',
      });
      if (tokErr || !atual) {
        resultado.push({ loja, ok: false, detalhe: 'sem token guardado' });
        continue;
      }

      const res = await fetch(
        `${GRAPH}/refresh_access_token?grant_type=ig_refresh_token`
        + `&access_token=${encodeURIComponent(String(atual))}`,
      );
      const txt = await res.text();

      if (!res.ok) {
        // Não apaga nada. Token que a Meta recusou renovar pode continuar
        // válido por semanas, e derrubar a conexão aqui transformaria um aviso
        // em queda.
        console.error(`[renovar-ig] ${loja}: ${txt.slice(0, 200)}`);
        resultado.push({ loja, ok: false, detalhe: `a Meta recusou (${res.status})` });
        continue;
      }

      const novo = JSON.parse(txt) as { access_token?: string; expires_in?: number };
      const token = String(novo?.access_token ?? '');
      if (!token) {
        resultado.push({ loja, ok: false, detalhe: 'resposta sem access_token' });
        continue;
      }

      const segundos = Number(novo?.expires_in ?? 60 * 24 * 3600);
      const expiraEm = new Date(Date.now() + segundos * 1000);

      // Vault primeiro. Se gravar a data e falhar o token, a conta ficaria com
      // validade nova e token velho — e sairia da fila de renovação levando o
      // problema junto.
      const { error: vaultErr } = await admin.rpc('set_meta_page_token', {
        p_user_id: conta.user_id,
        p_canal:   'instagram',
        p_token:   token,
      });
      if (vaultErr) {
        resultado.push({ loja, ok: false, detalhe: `falha ao guardar: ${vaultErr.message}` });
        continue;
      }

      await admin
        .from('company_settings')
        .update({ ig_token_expira_em: expiraEm.toISOString(), updated_at: new Date().toISOString() })
        .eq('user_id', conta.user_id);

      resultado.push({ loja, ok: true, detalhe: `vence em ${expiraEm.toLocaleDateString('pt-BR')}` });
      console.log(`[renovar-ig] ${loja}: renovado até ${expiraEm.toISOString()}`);

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[renovar-ig] ${loja}: exceção ${msg}`);
      resultado.push({ loja, ok: false, detalhe: msg });
    }
  }

  // Nenhum token na resposta, nem pedaço de um.
  return json({
    verificadas: (contas ?? []).length,
    renovadas:   resultado.filter((r) => r.ok).length,
    falhas:      resultado.filter((r) => !r.ok).length,
    detalhe:     resultado,
  });
});
