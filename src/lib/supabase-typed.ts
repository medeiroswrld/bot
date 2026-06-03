import { createClient } from '@supabase/supabase-js';
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
    lock: async (_name, _acquireTimeout, fn) => fn(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
