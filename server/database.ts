import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import {
  mkdirSync,
  chmodSync,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
  renameSync,
} from 'node:fs'
import { join } from 'node:path'
import * as schema from './schema.js'

export function openDatabase(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const path = join(dataDir, 'keyfolio.sqlite')
  const native = new Database(path)
  chmodSync(path, 0o600)
  native.pragma('journal_mode = WAL')
  native.pragma('foreign_keys = ON')
  native.pragma('busy_timeout = 5000')
  const version = native.pragma('user_version', { simple: true }) as number
  if (version > 1) throw new Error('数据库版本较新，请使用匹配的应用版本')
  if (version < 1)
    native.transaction(() => {
      native.exec(`
      CREATE TABLE owner (
        id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL,
        kdf_salt TEXT NOT NULL, auth_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL,
        wrapped_key TEXT NOT NULL, recovery_wrapped_key TEXT NOT NULL,
        totp_secret TEXT, last_totp_step INTEGER NOT NULL DEFAULT -1, created_at TEXT NOT NULL
      );
      CREATE TABLE vault (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, pending_totp TEXT, pending_expires_at INTEGER);
      CREATE INDEX sessions_expiry ON sessions(expires_at);
      PRAGMA user_version = 1;
    `)
    })()
  return { db: drizzle(native, { schema }), native }
}
export async function backupDatabase(
  native: Database.Database,
  backupDir: string,
  retention = 14,
  force = false
) {
  mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  const filename = `keyfolio-${new Date().toISOString().slice(0, 10)}.sqlite`
  const target = join(backupDir, filename)
  if (force || !existsSync(target)) {
    const temporary = `${target}.pending`
    try {
      await native.backup(temporary)
      chmodSync(temporary, 0o600)
      renameSync(temporary, target)
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary)
    }
  }
  const files = readdirSync(backupDir)
    .filter((f) => /^keyfolio-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f))
    .sort()
    .reverse()
  for (const file of files.slice(retention)) {
    const path = join(backupDir, file)
    if (statSync(path).isFile()) unlinkSync(path)
  }
  return { filename, lastBackupAt: statSync(target).mtime.toISOString() }
}
