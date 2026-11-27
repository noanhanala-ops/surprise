import { Controller, Get, Headers, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { CatalogService } from './catalog.service';

/** País do pedido: cabeçalho do CDN (Cloudflare) ou `x-country` (testes). Desconhecido => 'ZZ' (só contratos mundiais). */
const country = (h: Record<string, string | undefined>) => (h['cf-ipcountry'] ?? h['x-country'] ?? 'ZZ').toUpperCase().slice(0, 2);
const cur = (c?: string) => (c && /^[A-Za-z]{3}$/.test(c) ? c.toUpperCase() : 'USD');

@Controller()
export class CatalogController {
  constructor(private svc: CatalogService) {}
  @Get('books') list(@Headers() h: any, @Query('limit') limit = '20', @Query('cursor') cursor?: string, @Query('category') category?: string, @Query('language') language?: string, @Query('currency') currency?: string) {
    return this.svc.list(country(h), cur(currency), Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100), cursor, category, language);
  }
  @Get('books/:slug') get(@Headers() h: any, @Param('slug') slug: string, @Query('currency') currency?: string) { return this.svc.bySlug(slug, country(h), cur(currency)); }
  @Get('books/:id/editions') editions(@Headers() h: any, @Param('id', ParseUUIDPipe) id: string, @Query('currency') currency?: string) { return this.svc.editions(id, country(h), cur(currency)); }
  @Get('covers/:editionId')
  async cover(@Headers() h: any, @Param('editionId', ParseUUIDPipe) id: string, @Res() res: any) {
    const c = await this.svc.cover(id, country(h));
    res.set('Content-Type', c.type).set('X-Content-Type-Options', 'nosniff').set('Cache-Control', 'public, max-age=3600').send(c.data);
  }
  @Get('categories') categories() { return this.svc.categories(); }
}
