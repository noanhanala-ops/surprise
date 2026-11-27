import { ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { DbService } from '../common/db.service';
import { SecretBox } from '../security/secret-box';
import { base32Encode, newSecret, otpauthUri, verifyTotp } from './totp';

const RECOVERY_RE = /^[A-Z2-7]{5}-?[A-Z2-7]{5}$/i;
const hashRecovery = (c: string) => createHash('sha256').update(c.replace('-', '').toUpperCase()).digest();
const ISSUER = process.env.MFA_ISSUER ?? 'Livraria Digital';

@Injectable()
export class MfaService {
  private log = new Logger('Mfa');
  constructor(private db: DbService, private box: SecretBox) {}

  async enroll(userId: string, email: string) {
    return this.db.tx(async (c) => {
      if ((await c.query(`SELECT 1 FROM mfa_credentials WHERE user_id=$1 AND kind='TOTP' AND confirmed_at IS NOT NULL`, [userId])).rowCount)
        throw new ConflictException('O MFA já está ativo');
      await c.query(`DELETE FROM mfa_credentials WHERE user_id=$1 AND kind='TOTP' AND confirmed_at IS NULL`, [userId]); // re-inscrição substitui a pendente
      const secret = newSecret();
      await c.query(`INSERT INTO mfa_credentials (user_id, kind, secret_enc) VALUES ($1,'TOTP',$2)`, [userId, this.box.seal(secret)]);
      const b32 = base32Encode(secret);
      return { secret: b32, otpauth_uri: otpauthUri(ISSUER, email, b32) };
    });
  }

  /** Confirma a inscrição com um código válido, activa o MFA e devolve os códigos de recuperação (mostrados UMA vez). */
  async confirm(userId: string, code: string): Promise<string[]> {
    return this.db.tx(async (c) => {
      const cred = (await c.query(`SELECT id, secret_enc FROM mfa_credentials WHERE user_id=$1 AND kind='TOTP' AND confirmed_at IS NULL FOR UPDATE`, [userId])).rows[0];
      if (!cred) throw new ConflictException('Sem inscrição MFA pendente');
      const step = verifyTotp(this.box.open(cred.secret_enc), code);
      if (step === null) throw new UnauthorizedException('Código inválido');
      await c.query(`UPDATE mfa_credentials SET confirmed_at=now(), last_used_step=$2 WHERE id=$1`, [cred.id, step]);
      await c.query(`UPDATE users SET mfa_enabled=true WHERE id=$1`, [userId]);
      const codes: string[] = [];
      for (let i = 0; i < 10; i++) {
        const raw = base32Encode(randomBytes(7)).slice(0, 10); const shown = `${raw.slice(0, 5)}-${raw.slice(5)}`; codes.push(shown);
        await c.query(`INSERT INTO mfa_credentials (user_id, kind, secret_enc, confirmed_at) VALUES ($1,'RECOVERY_CODE',$2,now())`, [userId, hashRecovery(shown)]);
      }
      return codes;
    });
  }

  /** Verifica (e CONSOME) um código TOTP — não reutilizável — ou de recuperação — de uso único. */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const clean = code.trim();
    return this.db.tx(async (c) => {
      const cred = (await c.query(`SELECT id, secret_enc, last_used_step FROM mfa_credentials WHERE user_id=$1 AND kind='TOTP' AND confirmed_at IS NOT NULL FOR UPDATE`, [userId])).rows[0];
      if (!cred) return false;
      if (/^\d{6}$/.test(clean)) {
        const step = verifyTotp(this.box.open(cred.secret_enc), clean);
        if (step === null || (cred.last_used_step !== null && step <= Number(cred.last_used_step))) { this.log.warn(`TOTP recusado user=${userId} motivo=${step === null ? 'invalido' : 'replay'}`); return false; } // inválido ou repetido (replay)
        await c.query(`UPDATE mfa_credentials SET last_used_step=$2 WHERE id=$1`, [cred.id, step]);
        return true;
      }
      if (RECOVERY_RE.test(clean)) {
        const used = (await c.query(`DELETE FROM mfa_credentials WHERE user_id=$1 AND kind='RECOVERY_CODE' AND secret_enc=$2 RETURNING id`, [userId, hashRecovery(clean)])).rowCount === 1;
        if (!used) this.log.warn(`código de recuperação recusado user=${userId} (desconhecido ou já usado)`); return used;
      }
      this.log.warn(`código recusado user=${userId} motivo=formato`); return false;
    });
  }

  async remainingRecoveryCodes(userId: string) {
    return Number((await this.db.query(`SELECT count(*) n FROM mfa_credentials WHERE user_id=$1 AND kind='RECOVERY_CODE'`, [userId])).rows[0].n);
  }

  /** Desactivar exige um código válido; administradores não podem desactivar (política). */
  async disable(userId: string, code: string) {
    const admin = (await this.db.query(`SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND (r.name LIKE 'admin\\_%' OR r.name='super_admin')`, [userId])).rowCount;
    if (admin) throw new ForbiddenException('Administradores não podem desativar o MFA');
    if (!(await this.verifyCode(userId, code))) throw new UnauthorizedException('Código inválido');
    await this.db.tx(async (c) => { await c.query(`DELETE FROM mfa_credentials WHERE user_id=$1`, [userId]); await c.query(`UPDATE users SET mfa_enabled=false WHERE id=$1`, [userId]); await c.query(`UPDATE refresh_sessions SET mfa_at=NULL WHERE user_id=$1`, [userId]); });
  }
}
