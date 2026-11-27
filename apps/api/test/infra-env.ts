export function requireInfra(names: string[]) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`Testes de infra: variáveis em falta: ${missing.join(', ')}. Ver apps/api/README.md.`);
}
export async function eventually<T>(fn: () => Promise<T | false | undefined | null>, ms = 10000, step = 50): Promise<T> {
  const end = Date.now() + ms; let last: any;
  while (Date.now() < end) { try { const r = await fn(); if (r) return r as T; } catch (e) { last = e; } await new Promise((r) => setTimeout(r, step)); }
  throw new Error(`condição não cumprida em ${ms}ms${last ? `: ${last.message}` : ''}`);
}
