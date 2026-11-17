import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';

// Errors after which the pool itself cannot be trusted any more (it was ended, or
// Neon dropped its connections while the compute was suspended). The pool is
// rebuilt and the query retried once, so a long-running API recovers on its own.
const BROKEN_POOL = /pool after calling end|Connection terminated|Client has encountered a connection error|ECONNRESET|EPIPE|terminating connection/i;

/** Whether an error means the pool should be rebuilt. Exported for tests. */
export function isBrokenPoolError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message} ${(error as { code?: string }).code ?? ''}` : String(error);
  return BROKEN_POOL.test(message);
}

@Injectable()
export class PostgresService implements OnModuleDestroy {
  private readonly logger = new Logger(PostgresService.name);
  private pool?: Pool;

  private getPool(): Pool {
    if (!this.pool) {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) throw new Error('DATABASE_URL is required by the NestJS API. Set it in apps/api/.env.');
      const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000 });
      // An idle connection closed by the server emits 'error' on the pool; without a
      // listener Node treats it as unhandled. The broken client is dropped by pg.
      pool.on('error', (error) => this.logger.warn(`Idle database connection lost: ${error.message}`));
      this.pool = pool;
    }
    return this.pool;
  }

  private resetPool(reason: unknown) {
    const old = this.pool;
    this.pool = undefined;
    this.logger.warn(`Rebuilding the database pool after: ${reason instanceof Error ? reason.message : String(reason)}`);
    void old?.end().catch(() => undefined);
  }

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) {
    try {
      return await this.getPool().query<T>(sql, values);
    } catch (error) {
      if (!isBrokenPoolError(error)) throw error;
      this.resetPool(error);
      return this.getPool().query<T>(sql, values);
    }
  }

  async onModuleDestroy() { const pool = this.pool; this.pool = undefined; await pool?.end(); }
}
