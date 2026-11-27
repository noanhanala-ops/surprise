import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** TOTP (RFC 6238) / HOTP (RFC 4226) sobre HMAC-SHA1 — o que as apps autenticadoras (Google/Microsoft Authenticator, Authy…) suportam. */
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, v = 0, out = '';
  for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += A[(v >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += A[(v << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, v = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()) {
    const i = A.indexOf(ch); if (i < 0) throw new Error('base32 inválido');
    v = (v << 5) | i; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const newSecret = () => randomBytes(20); // 160 bits (recomendação da RFC 4226)

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(c).digest(); const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}
export const totpStep = (timeMs = Date.now(), stepSec = 30) => Math.floor(timeMs / 1000 / stepSec);
export const totp = (secret: Buffer, timeMs = Date.now(), digits = 6) => hotp(secret, totpStep(timeMs), digits);

/** Devolve o passo que bateu (para anti-replay) ou null. Tolera ±`window` passos (relógio desfasado). */
export function verifyTotp(secret: Buffer, code: string, timeMs = Date.now(), window = 1, digits = 6): number | null {
  if (!/^\d+$/.test(code) || code.length !== digits) return null;
  const now = totpStep(timeMs); let hit: number | null = null;
  for (let s = now - window; s <= now + window; s++) { // percorre sempre todos (tempo constante)
    const a = Buffer.from(hotp(secret, s, digits)); if (timingSafeEqual(a, Buffer.from(code)) && hit === null) hit = s;
  }
  return hit;
}
export const otpauthUri = (issuer: string, account: string, secretB32: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
