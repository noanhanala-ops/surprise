import { Body, Controller, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../identity/jwt-auth.guard';
import { UploadService } from './upload.service';

class CompleteDto { @IsString() @MaxLength(4000) upload_token: string; }

@Controller('uploads')
export class UploadController {
  constructor(private svc: UploadService) {}
  /** Modo directo: chamar depois de o PUT ao bucket terminar. */
  @UseGuards(JwtAuthGuard) @Post('complete') @HttpCode(201)
  complete(@CurrentUser() u: AuthUser, @Body() b: CompleteDto) { return this.svc.complete(u.id, b.upload_token); }
  /** Modo proxy (dev): equivalente local de um PUT pré-assinado. A autorização está no token. */
  @Put(':token') @HttpCode(201)
  put(@Param('token') token: string, @Req() req: any) { return this.svc.receive(token, req.body); }
}
