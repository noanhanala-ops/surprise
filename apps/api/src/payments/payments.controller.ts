import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, IsUrl, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../identity/jwt-auth.guard';
import { idemKey } from '../commerce/commerce.controller';
import { PaymentsService } from './payments.service';

export class CheckoutDto {
  @IsUUID() order_id: string;
  @IsString() @MaxLength(50) method: string;
  @IsOptional() @IsUrl({ require_tld: false }) return_url?: string;
}

@Controller()
export class PaymentsController {
  constructor(private svc: PaymentsService) {}
  @UseGuards(JwtAuthGuard) @Post('payments/checkout')
  checkout(@CurrentUser() u: AuthUser, @Body() b: CheckoutDto, @Headers('idempotency-key') k?: string) { idemKey(k); return this.svc.checkout(u.id, b.order_id, b.method, b.return_url); }
  @UseGuards(JwtAuthGuard) @Get('payments/methods') methods() { return this.svc.methods(); }
  @UseGuards(JwtAuthGuard) @Get('payments/:id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u.id, id); }
  @Post('webhooks/:provider') @HttpCode(202)
  webhook(@Param('provider') p: string, @Req() req: any) { return this.svc.handleWebhook(p, req.headers, req.rawBody ?? Buffer.alloc(0)); }
}
