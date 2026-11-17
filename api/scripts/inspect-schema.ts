import 'reflect-metadata';
import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in apps/api/.env before inspecting the existing tables.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const inventory = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name`);
    const result = await pool.query(`SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default, tc.constraint_type, tc.constraint_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name FROM information_schema.columns c LEFT JOIN information_schema.key_column_usage kcu ON kcu.table_schema=c.table_schema AND kcu.table_name=c.table_name AND kcu.column_name=c.column_name LEFT JOIN information_schema.table_constraints tc ON tc.table_schema=kcu.table_schema AND tc.constraint_name=kcu.constraint_name LEFT JOIN information_schema.constraint_column_usage ccu ON ccu.table_schema=tc.table_schema AND ccu.constraint_name=tc.constraint_name WHERE c.table_schema=current_schema() AND lower(c.table_name) IN ('channeltb','categorydb') ORDER BY c.table_name,c.ordinal_position`);
    console.log(JSON.stringify({ tables: inventory.rows.map((row) => row.table_name), inspectedColumns: result.rows }, null, 2));
  } finally { await pool.end(); }
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : 'Schema inspection failed'); process.exitCode = 1; });
