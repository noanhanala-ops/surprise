import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Res, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../identity/jwt-auth.guard';
import { StorageService } from '../storage/storage.service';
import { EntitlementsService } from './entitlements.service';

const MIME: Record<string, string> = { EPUB: 'application/epub+zip', PDF: 'application/pdf', COMIC: 'application/vnd.comicbook+zip' };

/** Não existe endpoint para criar/activar direitos: só o consumidor de PaymentCaptured o faz. */
@Controller()
export class EntitlementsController {
  constructor(private svc: EntitlementsService, private storage: StorageService) {}
  @UseGuards(JwtAuthGuard) @Get('library') library(@CurrentUser() u: AuthUser, @Query('limit') limit = '50') { return this.svc.library(u.id, Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)); }
  @UseGuards(JwtAuthGuard) @Get('library/:editionId/access') access(@CurrentUser() u: AuthUser, @Param('editionId', ParseUUIDPipe) id: string, @Query('format') f?: string) { return this.svc.access(u.id, id, f); }
  @UseGuards(JwtAuthGuard) @Get('entitlements') list(@CurrentUser() u: AuthUser) { return this.svc.list(u.id); }
  @UseGuards(JwtAuthGuard) @Get('entitlements/:id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u.id, id); }

  /** URL de curta duração devolvida por /library/:id/access. Entrega controlada (não é DRM). */
  @Get('content/:token') @Header('Cache-Control', 'private, no-store')
  async content(@Param('token') token: string, @Res() res: any) {
    const f = await this.svc.resolveContent(token);
    const data = await this.storage.get(f.storage_key);
    res.set('Content-Type', MIME[f.format] ?? 'application/octet-stream').set('Content-Length', String(data.length)).send(data);
  }
}
