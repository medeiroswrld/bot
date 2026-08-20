import { createClient } from '@supabase/supabase-js';

// Cliente do painel do administrador — SEPARADO do cliente do CRM.
//
// O que separa os dois é o `storageKey`. Sem ele, os dois compartilhariam a
// mesma sessão no navegador: entrar no painel derrubaria o login do lojista no
// CRM, e entrar no CRM derrubaria o seu. Foi exatamente o que aconteceu na
// primeira versão — o painel abria logado como "Dsc Seminovos".
//
// Com chaves diferentes dá pra estar logado como lojista no CRM e como
// administrador no /admin ao mesmo tempo, no mesmo navegador.
//
// (O aviso "Multiple GoTrueClient instances" do Supabase se refere a duas
// instâncias disputando o MESMO storage. Com chaves distintas elas não se
// enxergam, que é justamente o que queremos aqui.)
const url  = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseAdmin = createClient(url, anon, {
  auth: {
    storageKey: 'amply-admin-auth',
    autoRefreshToken: true,
    persistSession: true,
    // O painel não recebe callback de OAuth nem magic link; ligado, isso só
    // faria ele tentar consumir tokens da URL que não são dele.
    detectSessionInUrl: false,
  },
});
