import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BillingError, call } from '@pentwin/billing';
import { glyphMetadataSchema } from '@pentwin/engine';
import type { Pool } from 'pg';
import { z } from 'zod';

const bankSchema = z.strictObject({
  metadata: glyphMetadataSchema,
  files: z.record(z.string().max(100), z.string().max(200_000)),
});
export type StoredBank = z.infer<typeof bankSchema>;

/** Largest glyph bank accepted, in bytes of JSON. A full bank is a few hundred KB. */
const MAX_BANK_BYTES = 4 * 1024 * 1024;

export interface ProfileSummary {
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: string;
}

/**
 * Keeps users' handwriting profiles: a row in the database for each, and the glyph bank
 * itself as a file encrypted with AES-256-GCM. The key comes from the environment and
 * never touches the disk the files are on, so a copy of the storage alone reveals nothing.
 *
 * Files live on the worker's disk here. Moving them to object storage (R2 or Supabase
 * Storage) only means replacing the three file operations below.
 */
export function createProfileStore(pool: Pool, options: { directory: string; key: string }) {
  if (options.key.length < 32)
    throw new Error('The profile encryption key must be at least 32 characters');
  // Any sufficiently long secret is turned into a 256-bit key.
  const key = createHash('sha256').update(options.key).digest();
  const pathOf = (storageKey: string): string => join(options.directory, `${storageKey}.bin`);

  const encrypt = (plain: Buffer): Buffer => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  };
  const decrypt = (stored: Buffer): Buffer => {
    const decipher = createDecipheriv('aes-256-gcm', key, stored.subarray(0, 12));
    decipher.setAuthTag(stored.subarray(12, 28));
    return Buffer.concat([decipher.update(stored.subarray(28)), decipher.final()]);
  };

  const ownRow = async (
    userId: string,
    id: string,
  ): Promise<{ storage_key: string } | undefined> => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const { rows } = await pool.query(
      `select storage_key from public.handwriting_profiles where id = $1 and user_id = $2`,
      [id, userId],
    );
    return rows[0];
  };

  return {
    async list(userId: string): Promise<ProfileSummary[]> {
      const { rows } = await pool.query(
        `select id, name, size_bytes, created_at from public.handwriting_profiles
          where user_id = $1 order by created_at`,
        [userId],
      );
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        sizeBytes: row.size_bytes,
        createdAt: row.created_at.toISOString(),
      }));
    },

    /** Saves a profile, within the plan's limit and only with the own-handwriting confirmation. */
    async save(
      userId: string,
      input: { name?: unknown; bank?: unknown; style?: unknown; ownHandwriting?: unknown },
    ): Promise<ProfileSummary> {
      const bank = bankSchema.safeParse(input.bank);
      const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
      if (!bank.success || !name) {
        throw new BillingError('invalid_profile', 'This handwriting profile is not valid.', 400);
      }
      const plain = Buffer.from(JSON.stringify(bank.data));
      if (plain.length > MAX_BANK_BYTES) {
        throw new BillingError('profile_too_large', 'This handwriting profile is too large.', 413);
      }

      const storageKey = randomUUID();
      await mkdir(options.directory, { recursive: true });
      await writeFile(pathOf(storageKey), encrypt(plain));
      try {
        // The database enforces the limit and the confirmation; the file is only kept
        // if the row was accepted.
        const { rows } = await call(() =>
          pool.query(`select * from public.create_profile($1, $2, $3, $4, $5, $6)`, [
            userId,
            name,
            storageKey,
            plain.length,
            input.style === undefined ? null : JSON.stringify(input.style),
            input.ownHandwriting === true,
          ]),
        );
        return {
          id: rows[0].id,
          name: rows[0].name,
          sizeBytes: rows[0].size_bytes,
          createdAt: rows[0].created_at.toISOString(),
        };
      } catch (error) {
        await rm(pathOf(storageKey), { force: true });
        throw error;
      }
    },

    /** Loads one of the user's own profiles. Someone else's id behaves as if it did not exist. */
    async load(userId: string, id: string): Promise<StoredBank> {
      const row = await ownRow(userId, id);
      if (!row) throw new BillingError('profile_not_found', 'This profile does not exist.', 404);
      return JSON.parse(
        decrypt(await readFile(pathOf(row.storage_key))).toString('utf8'),
      ) as StoredBank;
    },

    /** Deletes one of the user's own profiles: the row and the file. */
    async remove(userId: string, id: string): Promise<void> {
      const row = await ownRow(userId, id);
      if (!row) throw new BillingError('profile_not_found', 'This profile does not exist.', 404);
      await pool.query(`delete from public.handwriting_profiles where id = $1 and user_id = $2`, [
        id,
        userId,
      ]);
      await rm(pathOf(row.storage_key), { force: true });
    },

    /** Deletes stored files by their storage keys, after their rows are already gone. */
    async removeFiles(storageKeys: readonly string[]): Promise<void> {
      await Promise.all(
        storageKeys
          .filter((storageKey) => /^[0-9a-f-]{36}$/i.test(storageKey))
          .map((storageKey) => rm(pathOf(storageKey), { force: true })),
      );
    },

    /**
     * Deletes stored files that no profile points to, and returns how many. Such a file
     * can only be left by a crash between writing it and recording it, or between
     * deleting an account and deleting its files. Files newer than `graceMs` are left
     * alone: a profile being saved right now has its file before its row.
     */
    async sweepOrphans(graceMs = 60 * 60 * 1000): Promise<number> {
      let names: string[];
      try {
        names = await readdir(options.directory);
      } catch {
        return 0;
      }
      const keys = names.flatMap((name) => /^([0-9a-f-]{36})\.bin$/i.exec(name)?.[1] ?? []);
      if (keys.length === 0) return 0;
      const { rows } = await pool.query<{ storage_key: string }>(
        `select storage_key from public.handwriting_profiles where storage_key = any($1)`,
        [keys],
      );
      const known = new Set(rows.map((row) => row.storage_key));
      let removed = 0;
      for (const storageKey of keys) {
        if (known.has(storageKey)) continue;
        const path = pathOf(storageKey);
        const info = await stat(path).catch(() => undefined);
        if (!info || Date.now() - info.mtimeMs < graceMs) continue;
        await rm(path, { force: true });
        removed++;
      }
      return removed;
    },
  };
}

export type ProfileStore = ReturnType<typeof createProfileStore>;
