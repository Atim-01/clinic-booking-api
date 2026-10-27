import pg from 'pg';
import { config } from './config.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Pool } = pg;

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL or TEST_DATABASE_URL is required');
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
});

// Apply schema on initialization
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const schemaPath = join(__dirname, '..', 'sql', 'schema.sql');

export async function initSchema(): Promise<void> {
  const schema = readFileSync(schemaPath, 'utf-8');
  await pool.query(schema);
}
