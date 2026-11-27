import { Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { CurrentUser, AuthUser, JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto, MfaCodeDto, MfaVerifyDto, RefreshDto, RegisterDto, VerifyEmailDto } from './dto';

@Controller()
export class IdentityController {
  constructor(private svc: IdentityService) {}

  @Post('auth/register') async register(@Body() dto: RegisterDto, @Ip() ip: string) { await this.svc.register(dto, ip); return { status: 'verification_email_queued' }; }
  @Post('auth/login') @HttpCode(200) login(@Body() dto: LoginDto, @Ip() ip: string) { return this.svc.login(dto, ip); }
  @Post('auth/refresh') @HttpCode(200) refresh(@Body() dto: RefreshDto) { return this.svc.refresh(dto.refresh_token); }
  @Post('auth/verify-email') @HttpCode(204) async verify(@Body() dto: VerifyEmailDto) { await this.svc.verifyEmail(dto.token); }
  @UseGuards(JwtAuthGuard) @Post('auth/logout') @HttpCode(204) async logout(@CurrentUser() u: AuthUser) { await this.svc.logout(u.sessionId); }

  @Post('auth/mfa/verify') @HttpCode(200) mfaVerify(@Body() b: MfaVerifyDto) { return this.svc.verifyMfa(b.challenge_id, b.code); }
  @UseGuards(JwtAuthGuard) @Post('auth/mfa/enroll') @HttpCode(200) mfaEnroll(@CurrentUser() u: AuthUser) { return this.svc.enrollMfa(u.id); }
  @UseGuards(JwtAuthGuard) @Post('auth/mfa/confirm') @HttpCode(200) mfaConfirm(@CurrentUser() u: AuthUser, @Body() b: MfaCodeDto) { return this.svc.confirmMfa(u.id, u.sessionId, b.code); }
  @UseGuards(JwtAuthGuard) @Post('auth/mfa/step-up') @HttpCode(200) mfaStepUp(@CurrentUser() u: AuthUser, @Body() b: MfaCodeDto) { return this.svc.stepUp(u.id, u.sessionId, b.code); }
  @UseGuards(JwtAuthGuard) @Post('auth/mfa/disable') @HttpCode(204) async mfaDisable(@CurrentUser() u: AuthUser, @Body() b: MfaCodeDto) { await this.svc.disableMfa(u.id, b.code); }

  @UseGuards(JwtAuthGuard) @Get('users/me') me(@CurrentUser() u: AuthUser) { return this.svc.me(u.id); }
  @UseGuards(JwtAuthGuard) @Get('users/me/devices') devices(@CurrentUser() u: AuthUser) { return this.svc.listDevices(u.id); }
  @UseGuards(JwtAuthGuard) @Delete('users/me/devices/:id') @HttpCode(204)
  async revoke(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.revokeDevice(u.id, id); }
}
