import { INestApplication, ValidationPipe } from '@nestjs/common';
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, errorHttpStatusCode: 422 }));
  return app;
}
