import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import { ReaderService } from './reader.service';

/**
 * O token (JWT 'read', 1 h) vai no caminho porque o navegador carrega recursos de iframes sem cabeçalho Authorization.
 * Mitigações: validade curta, direito revalidado a cada pedido, `Cache-Control: no-store`, sem Referer (ver web).
 */
@Controller('read/:token')
export class ReaderController {
  constructor(private svc: ReaderService) {}
  @Get('manifest.json') @Header('Cache-Control', 'private, no-store') @Header('Content-Type', 'application/webpub+json')
  manifest(@Param('token') t: string) { return this.svc.manifest(t); }
  @Get('positions.json') @Header('Cache-Control', 'private, no-store') @Header('Content-Type', 'application/vnd.readium.position-list+json')
  positions(@Param('token') t: string) { return this.svc.positions(t); }
  @Get('*path') @Header('Cache-Control', 'private, no-store') @Header('X-Content-Type-Options', 'nosniff')
  async resource(@Param('token') t: string, @Param('path') path: string | string[], @Res() res: any) {
    const r = await this.svc.resource(t, Array.isArray(path) ? path.join('/') : path);
    res.set('Content-Type', r.type).set('Content-Length', String(r.data.length)).send(r.data);
  }
}
