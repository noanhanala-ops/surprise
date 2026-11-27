import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../identity/jwt-auth.guard';
import { CommerceService } from './commerce.service';

export class CreateOrderDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID('all', { each: true }) edition_ids: string[];
  @Matches(/^[A-Za-z]{3}$/) currency: string;
  @Matches(/^[A-Za-z]{2}$/) billing_country: string;
}
export class RefundRequestDto {
  @IsString() @MinLength(3) @MaxLength(2000) reason: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) order_item_ids?: string[];
}
export const idemKey = (k?: string) => { if (!k || k.length < 8 || k.length > 128) throw new UnprocessableEntityException('Cabeçalho Idempotency-Key (8-128 caracteres) obrigatório'); return k; };

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class CommerceController {
  constructor(private svc: CommerceService) {}
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateOrderDto, @Headers('idempotency-key') k?: string) { return this.svc.createOrder(u.id, dto, idemKey(k)); }
  @Get() list(@CurrentUser() u: AuthUser, @Query('limit') limit = '20') { return this.svc.listOrders(u.id, Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.getOrder(u.id, id); }
  @Post(':id/refund-requests') @HttpCode(202)
  refund(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: RefundRequestDto, @Headers('idempotency-key') k?: string) {
    idemKey(k); return this.svc.requestRefund(u.id, id, b.reason, b.order_item_ids);
  }
}
