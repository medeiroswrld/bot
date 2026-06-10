// CORS com allowlist de origens para endpoints autenticados.
// O whatsapp-webhook NÃO usa isto (Meta chama de qualquer origem).

const ALLOWED_ORIGINS = [
  'https://amply.ia.br',
  'http://localhost:5173',
];

// Permite previews do Vercel (*.vercel.app) além da allowlist fixa.
function isAllowed(origin: string): boolean {
  return ALLOWED_ORIGINS.includes(origin) || /\.vercel\.app$/.test(origin);
}

export function buildCors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = isAllowed(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Vary': 'Origin',
  };
}
