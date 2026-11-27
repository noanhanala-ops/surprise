import { Controller, HttpCode, Param, Put, Req } from '@nestjs/common';
import { UploadService } from './upload.service';

/** Equivalente local de um PUT pré-assinado. A autorização está no token (JWT curto), não em sessão. */
@Controller('uploads')
export class UploadController {
  constructor(private svc: UploadService) {}
  @Put(':token') @HttpCode(201)
  put(@Param('token') token: string, @Req() req: any) { return this.svc.receive(token, req.body); }
}
