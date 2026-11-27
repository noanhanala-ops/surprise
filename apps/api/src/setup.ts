import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
export function configureApp(app: INestApplication) {
  // Falha ruidosa: o modo sandbox expõe pagamento simulado e verificação de e-mail sem autenticação.
  if (process.env.NODE_ENV === 'production' && process.env.SANDBOX_MODE === 'true') throw new Error('SANDBOX_MODE=true é proibido com NODE_ENV=production');
  // IP real atrás de proxy/CDN: TRUST_PROXY=1 (nº de saltos) ou 'true'. Sem isto o rate limit veria só o IP do proxy.
  if (process.env.TRUST_PROXY) (app as NestExpressApplication).set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY === 'true');
  app.setGlobalPrefix('v1');
  // Upload binário (PUT pré-assinado). Limite alinhado com o máximo do UploadIntentDto (2 GiB); em produção o upload vai directo ao bucket.
  (app as NestExpressApplication).useBodyParser('raw', { type: 'application/octet-stream', limit: process.env.UPLOAD_LIMIT ?? '512mb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, errorHttpStatusCode: 422 }));
  return app;
}
