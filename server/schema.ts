import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const owner = sqliteTable('owner', {
  id: integer('id').primaryKey(),
  username: text('username').notNull(),
  kdfSalt: text('kdf_salt').notNull(),
  authHash: text('auth_hash').notNull(),
  recoveryHash: text('recovery_hash').notNull(),
  wrappedKey: text('wrapped_key').notNull(),
  recoveryWrappedKey: text('recovery_wrapped_key').notNull(),
  totpSecret: text('totp_secret'),
  lastTotpStep: integer('last_totp_step').notNull().default(-1),
  createdAt: text('created_at').notNull(),
})
export const vault = sqliteTable('vault', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull(),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
})
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  expiresAt: integer('expires_at').notNull(),
  pendingTotp: text('pending_totp'),
  pendingExpiresAt: integer('pending_expires_at'),
})
