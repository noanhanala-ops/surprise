import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../identity/jwt-auth.guard';
import { PermissionsGuard, RequirePermission, RequireRecentMfa } from '../identity/permissions.guard';
import { ContractDto, ReasonDto } from '../publisher/dto';
import { AdminService } from './admin.service';
import { RefundsService, RefundDecision } from '../commerce/refunds.service';
import { PaymentsService } from '../payments/payments.service';
import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class RefundDecisionDto implements RefundDecision {
  @IsIn(['APPROVE', 'REJECT']) decision: 'APPROVE' | 'REJECT';
  @IsString() @Length(3, 2000) reason: string;
  @IsOptional() @IsBoolean() revoke_entitlement?: boolean;
  @IsOptional() @IsString() @Length(3, 1000) legal_basis?: string;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin')
export class AdminController {
  constructor(private svc: AdminService, private refunds: RefundsService, private payments: PaymentsService) {}
  @Post('publishers/:id/approve') @HttpCode(204) @RequirePermission('catalog.publisher.approve')
  async approvePublisher(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.approvePublisher(u.id, id); }
  /** Não consta do OpenAPI v1.0 (a acrescentar): criação de contrato de direitos + territórios. */
  @Post('contracts') @RequirePermission('contracts.manage')
  contract(@CurrentUser() u: AuthUser, @Body() dto: ContractDto) { return this.svc.createContract(u.id, dto); }
  @Post('books/:id/approve') @HttpCode(200) @RequirePermission('catalog.book.approve')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.approveEdition(u.id, id); }
  @Post('books/:id/reject') @HttpCode(204) @RequirePermission('catalog.book.approve')
  async reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto) { await this.svc.rejectEdition(u.id, id, b.reason); }
  @Post('books/:id/suspend') @HttpCode(204) @RequirePermission('catalog.book.suspend')
  async suspend(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto) { await this.svc.suspendEdition(u.id, id, b.reason); }
  @Get('publishers') @RequirePermission('catalog.publisher.approve') publishers(@Query('status') status?: string) { return this.svc.pendingPublishers(status); }
  @Get('books') @RequirePermission('catalog.book.approve') books(@Query('status') status?: string) { return this.svc.editionsByStatus(status); }
  @Get('books/:id') @RequirePermission('catalog.book.approve') book(@Param('id', ParseUUIDPipe) id: string) { return this.svc.editionDetail(id); }
  @Get('refunds') @RequirePermission('refunds.decide') listRefunds(@Query('status') status?: string) { return this.refunds.list(status ?? 'REQUESTED'); }
  @Post('refunds/:id/decision') @HttpCode(200) @RequirePermission('refunds.decide') @RequireRecentMfa(15)
  decide(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: RefundDecisionDto) { return this.refunds.decide(u.id, id, b); }
  @Post('payments/reconcile') @HttpCode(200) @RequirePermission('payments.read_all') reconcile() { return this.payments.reconcile(0); }
  @Get('content-jobs') @RequirePermission('content.processing.monitor') jobs() { return this.svc.contentJobs(); }
}
