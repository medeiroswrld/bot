// Mascara PII (telefone, nome) em logs para não vazar dados de clientes.

export function maskPhone(phone: string | null | undefined): string {
  const p = String(phone ?? '');
  if (p.length < 4) return '***';
  return `***${p.slice(-4)}`;
}

export function maskName(name: string | null | undefined): string {
  if (!name) return '***';
  return String(name).trim().split(/\s+/).map((p) => (p[0] ?? '') + '***').join(' ');
}
