import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ADMIN_API_TOKEN ?? '';
    if (expected.length < 32) throw new UnauthorizedException('Admin access is not configured.');
    const request = context.switchToHttp().getRequest<Request>();
    const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const a = Buffer.from(expected); const b = Buffer.from(supplied);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    return true;
  }
}
