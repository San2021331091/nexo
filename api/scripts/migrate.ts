import 'reflect-metadata';
import 'dotenv/config';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL in apps/api/.env before running database migrations.');
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS nexo_schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const version of ['001_content_catalog', '002_channel_health']) {
      const prior = await client.query('SELECT 1 FROM nexo_schema_migrations WHERE version=$1', [version]);
      if (prior.rowCount) { console.log(`${version} already applied.`); continue; }
      const sql = await readFile(resolve(process.cwd(), `../../db/migrations/${version}.sql`), 'utf8');
      await client.query('BEGIN');
      try { await client.query(sql); await client.query('INSERT INTO nexo_schema_migrations(version) VALUES($1)', [version]); await client.query('COMMIT'); }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      console.log(`Applied ${version}.`);
    }
  } finally { client.release(); await pool.end(); }
}
void migrate().catch((error) => { console.error(error instanceof Error ? error.message : 'Migration failed.'); process.exitCode = 1; });
