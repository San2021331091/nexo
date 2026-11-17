import 'reflect-metadata';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { configureApp, GLOBAL_PREFIX } from './app.factory';
import { AppModule } from './modules/app.module';

/**
 * Runs the API inside another Node server (the Next.js admin app on Vercel) instead
 * of listening on its own port. One Nest app is built per process and reused.
 */
type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let handlerPromise: Promise<Handler> | undefined;
let localBasePromise: Promise<string> | undefined;

async function build(): Promise<Handler> {
  // Serverless instances freeze between requests, so background timers are off
  // unless explicitly configured. Trigger health checks with a cron instead.
  process.env.CHANNEL_HEALTH_INTERVAL_MINUTES ??= 'off';
  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { logger: ['error', 'warn', 'log'] });
  configureApp(app, { trustProxy: true });
  await app.init();
  return server as unknown as Handler;
}

export function getHandler(): Promise<Handler> {
  handlerPromise ??= build().catch((error) => { handlerPromise = undefined; throw error; });
  return handlerPromise;
}

/**
 * Base URL of a loopback listener inside this process, for server code that talks
 * to the API with fetch(). Nothing leaves the machine.
 */
export function localBaseUrl(): Promise<string> {
  localBasePromise ??= getHandler().then((handler) => new Promise<string>((resolve, reject) => {
    const server: Server = createServer(handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.unref();
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/${GLOBAL_PREFIX}`);
    });
  })).catch((error) => { localBasePromise = undefined; throw error; });
  return localBasePromise;
}
