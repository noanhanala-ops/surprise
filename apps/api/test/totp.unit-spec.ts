import { base32Decode, base32Encode, hotp, newSecret, otpauthUri, totp, verifyTotp } from '../src/identity/totp';
import { SecretBox } from '../src/security/secret-box';

describe('TOTP / HOTP (RFC 4226 e 6238)', () => {
  const key = Buffer.from('12345678901234567890'); // semente de teste das RFCs

  it('HOTP: vectores oficiais da RFC 4226 (Apêndice D)', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => hotp(key, c))).toEqual(['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']);
  });
  it('TOTP: vectores oficiais da RFC 6238 (SHA-1, 8 dígitos)', () => {
    const v: [number, string][] = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
    for (const [t, code] of v) expect(totp(key, t * 1000, 8)).toBe(code);
  });
  it('base32: ida-e-volta e vector RFC 4648', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI'); expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    const s = newSecret(); expect(base32Decode(base32Encode(s)).equals(s)).toBe(true); expect(s).toHaveLength(20);
    expect(() => base32Decode('1!')).toThrow();
  });
  it('verifyTotp: devolve o passo; tolera ±1 passo; rejeita fora da janela e formatos inválidos', () => {
    const now = 1_700_000_000_000; const step = Math.floor(now / 30000);
    expect(verifyTotp(key, totp(key, now), now)).toBe(step);
    expect(verifyTotp(key, totp(key, now - 30000), now)).toBe(step - 1);
    expect(verifyTotp(key, totp(key, now + 30000), now)).toBe(step + 1);
    expect(verifyTotp(key, totp(key, now - 90000), now)).toBeNull();
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 345']) expect(verifyTotp(key, bad, now)).toBeNull();
  });
  it('otpauth URI para apps autenticadoras', () => {
    expect(otpauthUri('Livraria Digital', 'a@b.pt', 'ABC')).toBe('otpauth://totp/Livraria%20Digital:a%40b.pt?secret=ABC&issuer=Livraria%20Digital&algorithm=SHA1&digits=6&period=30');
  });
});

describe('SecretBox (AES-256-GCM)', () => {
  const box = new SecretBox();
  it('cifra e decifra; cada cifra é diferente (IV aleatório); adulteração é detectada', () => {
    const s = Buffer.from('segredo-totp-0123456789');
    const a = box.seal(s), b = box.seal(s);
    expect(a.equals(b)).toBe(false); expect(a.includes(s)).toBe(false); expect(box.open(a).equals(s)).toBe(true);
    const t = Buffer.from(a); t[t.length - 1] ^= 1; expect(() => box.open(t)).toThrow();
  });
  it('em produção exige MFA_ENC_KEY', () => {
    const e = { ...process.env }; process.env.NODE_ENV = 'production'; delete process.env.MFA_ENC_KEY;
    try { expect(() => new SecretBox().seal(Buffer.from('x'))).toThrow(/MFA_ENC_KEY/); } finally { process.env = e; }
  });
});
