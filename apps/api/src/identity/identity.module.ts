import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { MfaService } from './mfa.service';
import { SecretBox } from '../security/secret-box';

@Module({
  imports: [JwtModule.registerAsync({ useFactory: () => {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) throw new Error('JWT_SECRET (>=32 chars) é obrigatório');
    return { secret, signOptions: { algorithm: 'HS256', issuer: 'drp-api' }, verifyOptions: { algorithms: ['HS256'], issuer: 'drp-api' } };
  } })],
  controllers: [IdentityController],
  providers: [IdentityService, JwtAuthGuard, PermissionsGuard, MfaService, SecretBox],
  exports: [JwtAuthGuard, PermissionsGuard, JwtModule],
})
export class IdentityModule {}
