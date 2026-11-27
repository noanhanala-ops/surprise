import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { CurrentUser, AuthUser, JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto, RefreshDto, RegisterDto, VerifyEmailDto } from './dto';

@Controller()
export class IdentityController {
  constructor(private svc: IdentityService) {}

  @Post('auth/register') async register(@Body() dto: RegisterDto) { await this.svc.register(dto); return { status: 'verification_email_queued' }; }
  @Post('auth/login') @HttpCode(200) login(@Body() dto: LoginDto) { return this.svc.login(dto); }
  @Post('auth/refresh') @HttpCode(200) refresh(@Body() dto: RefreshDto) { return this.svc.refresh(dto.refresh_token); }
  @Post('auth/verify-email') @HttpCode(204) async verify(@Body() dto: VerifyEmailDto) { await this.svc.verifyEmail(dto.token); }
  @UseGuards(JwtAuthGuard) @Post('auth/logout') @HttpCode(204) async logout(@CurrentUser() u: AuthUser) { await this.svc.logout(u.sessionId); }

  @UseGuards(JwtAuthGuard) @Get('users/me') me(@CurrentUser() u: AuthUser) { return this.svc.me(u.id); }
  @UseGuards(JwtAuthGuard) @Get('users/me/devices') devices(@CurrentUser() u: AuthUser) { return this.svc.listDevices(u.id); }
  @UseGuards(JwtAuthGuard) @Delete('users/me/devices/:id') @HttpCode(204)
  async revoke(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.revokeDevice(u.id, id); }
}
