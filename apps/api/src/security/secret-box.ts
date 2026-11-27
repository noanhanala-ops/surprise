import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

/**
 * Cifra segredos em repouso (AES-256-GCM): iv(12) | tag(16) | cifra. Em produção MFA_ENC_KEY (32 bytes, base64) é obrigatória —
 * deve vir de um KMS/gestor de segredos. Fora de produção deriva-se do JWT_SECRET (só conveniência de desenvolvimento).
 */
@Injectable()
export class SecretBox {
  private key(): Buffer {
    const k = process.env.MFA_ENC_KEY;
    if (k) { const b = Buffer.from(k, 'base64'); if (b.length !== 32) throw new Error('MFA_ENC_KEY tem de ter 32 bytes (base64)'); return b; }
    if (process.env.NODE_ENV === 'production') throw new Error('MFA_ENC_KEY é obrigatória em produção');
    return Buffer.from(hkdfSync('sha256', process.env.JWT_SECRET ?? 'dev', 'drp-mfa', 'secret-box', 32));
  }
  seal(plain: Buffer): Buffer {
    const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', this.key(), iv);
    const ct = Buffer.concat([c.update(plain), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]);
  }
  open(blob: Buffer): Buffer {
    const d = createDecipheriv('aes-256-gcm', this.key(), blob.subarray(0, 12)); d.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
  }
}
