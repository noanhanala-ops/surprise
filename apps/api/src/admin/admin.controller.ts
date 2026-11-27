import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../identity/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../identity/permissions.guard';
import { ContractDto, ReasonDto } from '../publisher/dto';
import { AdminService } from './admin.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin')
export class AdminController {
  constructor(private svc: AdminService) {}
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
  @Get('content-jobs') @RequirePermission('content.processing.monitor') jobs() { return this.svc.contentJobs(); }
}
