import { z } from 'zod'

export const KDF_ITERATIONS = 600_000
export const MAX_VAULT_BYTES = 8 * 1024 * 1024
export const encoded32 = z.string().regex(/^[A-Za-z0-9+/]{43}=$/)
export const envelopeSchema = z
  .object({
    iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
    ciphertext: z
      .string()
      .min(24)
      .max(MAX_VAULT_BYTES)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict()
export type Envelope = z.infer<typeof envelopeSchema>
export const wrappedKeySchema = envelopeSchema.extend({
  ciphertext: z
    .string()
    .length(64)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
})
export const credentialsSchema = z
  .object({
    username: z.string().trim().min(1).max(64),
    kdfSalt: encoded32,
    wrappedKey: wrappedKeySchema,
    recoveryWrappedKey: wrappedKeySchema,
    authProof: encoded32,
    recoveryProof: encoded32,
  })
  .strict()
export type Credentials = z.infer<typeof credentialsSchema>
export type PublicProfile = {
  username: string
  kdfSalt: string
  wrappedKey: Envelope
  recoveryWrappedKey: Envelope
  kdfIterations: typeof KDF_ITERATIONS
}
// Only the random recovery-key wrapper is safe to expose before authentication.
export type LoginProfile = Omit<PublicProfile, 'wrappedKey'>
export type VaultResponse = {
  revision: number
  payload: Envelope
  updatedAt: string
}
export const backupSchema = z
  .object({
    format: z.literal('keyfolio-encrypted-backup'),
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    profile: z
      .object({
        username: z.string().max(64),
        kdfSalt: encoded32,
        wrappedKey: wrappedKeySchema,
        recoveryWrappedKey: wrappedKeySchema,
        kdfIterations: z.literal(KDF_ITERATIONS),
      })
      .strict(),
    payload: envelopeSchema,
  })
  .strict()
export type BackupFile = z.infer<typeof backupSchema>
export const captureItemSchema = z
  .object({
    action: z.enum(['create', 'update']).default('create'),
    platform: z.string().max(200),
    username: z.string().max(320).optional(),
    subject: z.string().max(200).optional(),
    category: z.string().max(100).optional(),
    tags: z.array(z.string().max(80)).max(20).optional(),
    email: z.string().max(320).optional(),
    phone: z.string().max(64).optional(),
    url: z.string().max(2048).optional(),
    notes: z.string().max(4000).optional(),
    loginMethod: z.string().max(100).optional(),
    status: z.enum(['active', 'inactive', 'pending']).optional(),
  })
  .strict()
export type CaptureItem = z.infer<typeof captureItemSchema>
export const captureResponseSchema = z
  .object({ items: z.array(captureItemSchema).min(1).max(20) })
  .strict()
export const searchPlanSchema = z
  .object({
    keywords: z.array(z.string().max(100)).max(10).default([]),
    subject: z.string().max(200).optional(),
    category: z.string().max(100).optional(),
    favorite: z.boolean().optional(),
    status: z.enum(['active', 'inactive', 'pending']).optional(),
    updatedAfter: z.string().datetime().optional(),
    updatedBefore: z.string().datetime().optional(),
    changedField: z
      .enum(['password', 'email', 'phone', 'subjectId', 'username'])
      .optional(),
  })
  .strict()
export type SearchPlan = z.infer<typeof searchPlanSchema>
