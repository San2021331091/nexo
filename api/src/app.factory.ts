import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

export const GLOBAL_PREFIX = 'api/v1';

/** Shared setup for the standalone server (main.ts) and the embedded handler (serverless.ts). */
export function configureApp(app: INestApplication, options: { swagger?: boolean; trustProxy?: boolean } = {}) {
  app.setGlobalPrefix(GLOBAL_PREFIX);
  if (options.trustProxy) app.getHttpAdapter().getInstance().set('trust proxy', true);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], frameSrc: ["'self'", 'https://www.youtube-nocookie.com'], mediaSrc: ["'self'", 'https:'], imgSrc: ["'self'", 'data:', 'https:'] } } }));
  const searchWindows = new Map<string, { count: number; start: number }>();
  app.use(`/${GLOBAL_PREFIX}/search`, (request: Request, response: Response, next: NextFunction) => {
    const now = Date.now(); const key = request.ip ?? 'unknown'; const entry = searchWindows.get(key);
    if (!entry || now - entry.start >= 60_000) searchWindows.set(key, { count: 1, start: now });
    else if (entry.count >= 60) { response.status(429).json({ statusCode: 429, message: 'Too many searches. Try again shortly.' }); return; }
    else entry.count++;
    if (searchWindows.size > 10_000) for (const [ip, item] of searchWindows) if (now - item.start >= 60_000) searchWindows.delete(ip);
    next();
  });
  app.enableCors({ origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((v) => v.trim()), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  if (options.swagger) {
    const swagger = new DocumentBuilder().setTitle('NEXO API').setDescription('Guest first streaming discovery catalog').setVersion('1.0').addBearerAuth().build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));
  }
  return app;
}
