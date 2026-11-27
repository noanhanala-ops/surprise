import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('v1');
  // Upload binário (PUT pré-assinado). Limite alinhado com o máximo do UploadIntentDto (2 GiB); em produção o upload vai directo ao bucket.
  (app as NestExpressApplication).useBodyParser('raw', { type: 'application/octet-stream', limit: process.env.UPLOAD_LIMIT ?? '512mb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, errorHttpStatusCode: 422 }));
  return app;
}
