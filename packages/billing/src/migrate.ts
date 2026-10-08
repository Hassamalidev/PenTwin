import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client, Pool } from 'pg';

/** Applies every .sql file in a directory, in name order, each in its own transaction. */
export async function applyMigrations(db: Pool | Client, directory: string): Promise<string[]> {
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(directory, file), 'utf8');
    try {
      await db.query(`begin;\n${sql}\ncommit;`);
    } catch (error) {
      await db.query('rollback').catch(() => undefined);
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
    }
  }
  return files;
}
