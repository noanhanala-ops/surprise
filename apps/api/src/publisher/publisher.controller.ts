import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../identity/jwt-auth.guard';
import { PublisherBookInput, RegisterPublisherDto, UploadIntentDto } from './dto';
import { PublisherService } from './publisher.service';
import { PublisherReportsService } from './publisher-reports.service';

@UseGuards(JwtAuthGuard)
@Controller('publisher')
export class PublisherController {
  constructor(private svc: PublisherService, private reports: PublisherReportsService) {}

  /** Não consta do OpenAPI v1.0: onboarding da editora (fica PENDING até aprovação admin). */
  @Post('register') register(@CurrentUser() u: AuthUser, @Body() dto: RegisterPublisherDto) { return this.svc.registerPublisher(u.id, dto); }
  @Get('me') mine(@CurrentUser() u: AuthUser) { return this.reports.myPublishers(u.id); }
  @Get('books/:id') detail(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.reports.editionDetail(u.id, id); }
  @Get('sales') sales(@CurrentUser() u: AuthUser) { return this.reports.sales(u.id); }
  @Get('royalties') royalties(@CurrentUser() u: AuthUser) { return this.reports.royalties(u.id); }
  @Get('payouts') payouts(@CurrentUser() u: AuthUser) { return this.reports.payouts(u.id); }
  @Get('contracts') contracts(@CurrentUser() u: AuthUser) { return this.reports.contracts(u.id); }
  @Get('books') list(@CurrentUser() u: AuthUser) { return this.svc.myBooks(u.id); }
  @Post('books') create(@CurrentUser() u: AuthUser, @Body() dto: PublisherBookInput) { return this.svc.createBook(u.id, dto); }
  /** `:id` é o id da EDIÇÃO. */
  @Put('books/:id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PublisherBookInput) { return this.svc.updateBook(u.id, id, dto); }
  @Post('books/:id/assets') assets(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UploadIntentDto, @Req() req: any) {
    return this.svc.uploadIntent(u.id, id, dto, process.env.PUBLIC_BASE_URL ?? `${req.protocol}://${req.get('host')}`);
  }
  @Post('books/:id/submit') @HttpCode(200) submit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.submit(u.id, id); }
}
