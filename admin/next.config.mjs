import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // The NestJS API (apps/api, compiled to dist) runs inside this app at /api/v1.
  // Nest and its peers load optional packages at runtime, so they stay as plain
  // Node requires instead of being bundled; tracing from the workspace root lets
  // Vercel ship them with the function.
  serverExternalPackages: [
    '@nestjs/common', '@nestjs/core', '@nestjs/config', '@nestjs/platform-express', '@nestjs/swagger',
    '@nestjs/mapped-types', 'class-transformer', 'class-validator', 'express', 'helmet', 'pg', 'reflect-metadata',
  ],
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  async headers() {
    const scriptSrc = process.env.NODE_ENV === 'development'
      ? "'self' 'unsafe-inline' 'unsafe-eval'"
      : "'self' 'unsafe-inline'";
    const connectSrc = process.env.NODE_ENV === 'development'
      ? "'self' http://localhost:4000"
      : "'self'";
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src ${connectSrc}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` },
    ] }];
  },
};
export default nextConfig;
