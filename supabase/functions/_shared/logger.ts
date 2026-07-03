// _shared/logger.ts
// Logger estruturado (1 linha = 1 JSON) para Supabase Edge Functions (Deno).
// Níveis com corte por LOG_LEVEL, contexto herdável via child(), e mascaramento
// automático de PII/segredos via maskDeep. É o que Winston/Pino dariam, em Deno.

import { maskDeep } from './mask.ts';

type Level = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

// Corte por ambiente: lido 1x no load. Ex.: LOG_LEVEL=warn silencia debug/info em prod.
const THRESHOLD = ORDER[(Deno.env.get('LOG_LEVEL') ?? 'info').toLowerCase() as Level] ?? ORDER.info;

export type LogContext = Record<string, unknown>; // fn, requestId, userId, action, ...

class Logger {
  constructor(private ctx: LogContext = {}) {}

  // Logger-filho: herda o contexto e fixa campos novos (ex.: requestId, userId).
  child(extra: LogContext): Logger {
    return new Logger({ ...this.ctx, ...extra });
  }

  private emit(level: Level, msg: string, fields?: LogContext) {
    if (ORDER[level] < THRESHOLD) return;                 // ← corte por LOG_LEVEL
    const safe = maskDeep({ ts: new Date().toISOString(), level, msg, ...this.ctx, ...fields });
    const line = JSON.stringify(safe);
    if (level === 'error' || level === 'fatal') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  debug(msg: string, f?: LogContext) { this.emit('debug', msg, f); }
  info(msg: string, f?: LogContext)  { this.emit('info',  msg, f); }
  warn(msg: string, f?: LogContext)  { this.emit('warn',  msg, f); }
  error(msg: string, f?: LogContext) { this.emit('error', msg, f); }
  fatal(msg: string, f?: LogContext) { this.emit('fatal', msg, f); }
}

// Logger raiz (sem contexto). Cada função cria o seu com .child({ fn, requestId, userId }).
export const logger = new Logger();

// requestId ponta-a-ponta: reaproveita o header se veio, senão gera.
export function requestIdFrom(req: Request): string {
  return req.headers.get('x-request-id') ?? crypto.randomUUID();
}

// Açúcar p/ instrumentar uma invocação inteira: cria o child logger (fn+requestId),
// loga início/fim/duração e QUALQUER erro não tratado automaticamente.
export async function withRequest<T>(
  req: Request,
  fn: string,
  handler: (log: Logger, requestId: string) => Promise<T>,
): Promise<T> {
  const requestId = requestIdFrom(req);
  const log = logger.child({ fn, requestId });
  const t0 = Date.now();
  log.info('início');
  try {
    const out = await handler(log, requestId);
    log.info('fim', { ms: Date.now() - t0 });
    return out;
  } catch (e) {
    log.error('erro não tratado', { ms: Date.now() - t0, error: e });
    throw e;
  }
}

export type { Logger };
