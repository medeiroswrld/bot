// Único cliente Supabase do app — instância criada em supabase-typed.ts.
// Re-exportado aqui para que os arquivos .jsx existentes não precisem mudar.
// Ter dois createClient() no mesmo app causa "Multiple GoTrueClient instances"
// e bugs intermitentes de sessão.
export { supabaseTyped as supabase } from './supabase-typed.ts';
