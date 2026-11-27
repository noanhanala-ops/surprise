import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './setup';

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule, { rawBody: true }));
  await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
