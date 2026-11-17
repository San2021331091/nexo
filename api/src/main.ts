import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureApp } from './app.factory';
import { AppModule } from './modules/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  configureApp(app, { swagger: true });
  await app.listen(Number(process.env.PORT ?? 4000));
}
void bootstrap();
