import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PORT = Number(process.env.PORT || 3000);
export const ROOT_DIR = process.cwd();
export const DATA_DIR = path.resolve(ROOT_DIR, 'data');
export const DB_PATH = path.join(DATA_DIR, 'taurus.db');
export const STORAGE_DIR = path.join(DATA_DIR, 'storage');
const MASTER_KEY_PATH = path.join(DATA_DIR, '.taurus_master_key');

export function ensureDataDirectories(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

let cachedMasterKey: Buffer | null = null;

export function getMasterEncryptionKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;

  ensureDataDirectories();

  if (process.env.TAURUS_ENCRYPTION_KEY) {
    cachedMasterKey = crypto
      .createHash('sha256')
      .update(process.env.TAURUS_ENCRYPTION_KEY)
      .digest();
    return cachedMasterKey;
  }

  if (fs.existsSync(MASTER_KEY_PATH)) {
    const rawHex = fs.readFileSync(MASTER_KEY_PATH, 'utf8').trim();
    if (rawHex.length === 64) {
      cachedMasterKey = Buffer.from(rawHex, 'hex');
      return cachedMasterKey;
    }
  }

  const fresh = crypto.randomBytes(32);
  fs.writeFileSync(MASTER_KEY_PATH, fresh.toString('hex'), { mode: 0o600 });
  cachedMasterKey = fresh;
  return cachedMasterKey;
}
