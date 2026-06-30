import { createClient, processLock } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Variáveis de ambiente do Supabase não encontradas. Verifique o arquivo .env');
}

// Cliente tipado — use nos arquivos TypeScript novos.
// Os arquivos .jsx existentes continuam usando o cliente em supabase.js.
export const supabaseTyped = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Lock REAL em processo (fila de promises): serializa o refresh de token e
    // evita a corrida de rotação ("Invalid Refresh Token: Already Used") que
    // deixava a sessão intermitentemente inválida (Conversas em loading infinito,
    // Configurações vazia até dar F5). NÃO usa Navigator Locks (que travava o
    // getSession) nem o no-op anterior (que desligava a serialização do refresh).
    lock: processLock,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
