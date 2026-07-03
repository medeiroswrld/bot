// _shared/mask.ts
// Mascaramento de PII/segredos para logs. maskPhone/maskName continuam exportados
// (retrocompat com quem já importa maskPII). O maskDeep é o coração — usado
// automaticamente pelo logger antes de qualquer linha sair.

// ─── mascaradores de campo ──────────────────────────────────────────────────
export function maskPhone(phone: string | null | undefined): string {
  const p = String(phone ?? '').replace(/\D/g, '');
  return p.length < 4 ? '***' : `***${p.slice(-4)}`;
}

export function maskName(name: string | null | undefined): string {
  if (!name) return '***';
  return String(name).trim().split(/\s+/).map((p) => (p[0] ?? '') + '***').join(' ');
}

export function maskEmail(email: string | null | undefined): string {
  const e = String(email ?? '');
  const at = e.indexOf('@');
  if (at < 1) return '***';
  return `${e[0]}***@${e.slice(at + 1)}`;
}

export function maskToken(token: string | null | undefined): string {
  const t = String(token ?? '');
  return t.length < 8 ? '***' : `***${t.slice(-4)} (len ${t.length})`; // fim só, pra distinguir sem vazar
}

export function maskCPF(cpf: string | null | undefined): string {
  const d = String(cpf ?? '').replace(/\D/g, '');
  return d.length === 11 ? `***.***.${d.slice(6, 9)}-**` : '***';
}

// ─── maskDeep: mascara um objeto/valor inteiro pra log ──────────────────────

// (a) Por NOME de chave (case-insensitive, match parcial) → o valor é sempre mascarado.
const SENSITIVE_KEYS: Array<[RegExp, (v: string) => string]> = [
  [/token|authorization|bearer|api[_-]?key|secret|password|senha|refresh/i, maskToken],
  [/e-?mail/i,                                    maskEmail],
  [/cpf/i,                                        maskCPF],
  [/phone|telefone|whatsapp_number|customer_phone|\bfrom\b|\bto\b|\bpid\b/i, maskPhone],
  [/customer_name|\bnome\b|\bname\b/i,            maskName],
];

// (b) Por PADRÃO de valor (string solta, mesmo sem chave sensível).
const VALUE_PATTERNS: Array<[RegExp, (m: string) => string]> = [
  [/Bearer\s+[A-Za-z0-9._\-]+/gi,                 () => 'Bearer ***'],
  [/eyJ[A-Za-z0-9._\-]{10,}/g,                    () => '***JWT***'],       // JWT / token Meta
  [/EAA[A-Za-z0-9]{20,}/g,                        () => '***WA_TOKEN***'],  // token WhatsApp (começa com EAA)
  [/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, (m) => maskEmail(m)],
  [/(?:\+?55)?\s*\(?\d{2}\)?\s*9?\d{4}[\s\-]?\d{4}/g,   (m) => maskPhone(m)],
];

function maskString(s: string): string {
  let out = s;
  for (const [re, fn] of VALUE_PATTERNS) out = out.replace(re, fn as (m: string) => string);
  return out;
}

function maskByKey(key: string, value: unknown): unknown | undefined {
  for (const [re, fn] of SENSITIVE_KEYS) {
    if (re.test(key)) return value == null ? value : (typeof value === 'string' ? fn(value) : '***');
  }
  return undefined; // não é chave sensível → decide pelo tipo no maskDeep
}

export function maskDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value == null) return value;
  if (typeof value === 'string') return maskString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return { name: value.name, message: maskString(value.message) };
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const byKey = maskByKey(k, v);
      out[k] = byKey !== undefined ? byKey : maskDeep(v, depth + 1);
    }
    return out;
  }
  return String(value);
}
