import { z } from 'zod'
import { type VaultData } from './model'
import { validTOTP } from './totp'

const id = z.string().min(1).max(100)
const title = z.string().trim().min(1).max(200)
export const accountSchema = z
  .object({
    id,
    platform: title,
    username: z.string().trim().min(1).max(320),
    password: z.string().max(4096),
    url: z
      .string()
      .max(2048)
      .refine(
        (v) =>
          !v ||
          (/^https?:\/\//i.test(v) &&
            (() => {
              try {
                const u = new URL(v)
                return !u.username && !u.password
              } catch {
                return false
              }
            })()),
        '请填写完整的 http 或 https 登录地址'
      ),
    subjectId: z.string().max(100),
    category: z.string().min(1).max(100),
    tags: z.array(z.string().min(1).max(80)).max(30),
    email: z.string().max(320),
    phone: z.string().max(64),
    loginMethod: z.string().max(100),
    status: z.enum(['active', 'inactive', 'pending']),
    notes: z.string().max(20000),
    favorite: z.boolean(),
    alias: z.string().trim().max(200).optional(),
    customFields: z
      .array(
        z
          .object({
            id,
            label: title,
            value: z.string().max(4096),
            secret: z.boolean(),
          })
          .strict()
      )
      .max(30)
      .refine(
        (fields) => new Set(fields.map((f) => f.id)).size === fields.length,
        '自定义字段标识重复'
      )
      .optional(),
    expiresOn: z
      .string()
      .refine(
        (v) =>
          !v ||
          (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
            !Number.isNaN(Date.parse(v)) &&
            new Date(v).toISOString().slice(0, 10) === v),
        '到期日期无效'
      )
      .optional(),
    reminderDays: z.number().int().min(0).max(365).optional(),
    totp: z
      .string()
      .max(4096)
      .refine(
        (v) => !v || validTOTP(v),
        '请输入有效的 Base32 密钥或 otpauth://totp 地址'
      )
      .optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
export const subjectSchema = z
  .object({
    id,
    name: title,
    type: z.enum(['personal', 'company']),
    aliases: z.array(z.string().min(1).max(200)).max(20),
    color: z.enum(['green', 'blue', 'purple', 'orange']),
  })
  .strict()
const changeSchema = z
  .object({
    id,
    accountId: id,
    platform: title,
    action: z.enum(['create', 'update', 'delete', 'restore']),
    at: z.string().datetime(),
    source: z.enum(['manual', 'ai', 'import']),
    fields: z.array(z.string().max(100)).max(30),
    before: accountSchema.nullable(),
    after: accountSchema.nullable(),
  })
  .strict()
export const vaultSchema = z
  .object({
    schemaVersion: z.literal(1),
    accounts: z.array(accountSchema).max(10000),
    subjects: z.array(subjectSchema).max(1000),
    categories: z.array(z.string().min(1).max(100)).max(1000),
    changes: z.array(changeSchema).max(100000),
    savedViews: z
      .array(
        z
          .object({
            id,
            name: title,
            filter: z
              .object({
                subject: z.string().max(100),
                category: z.string().max(100),
                status: z.enum(['all', 'active', 'inactive', 'pending']),
                favorite: z.boolean(),
                tags: z.array(z.string().min(1).max(80)).max(30),
                issue: z.enum(['all', 'missing', 'weak', 'reused', 'due']),
                query: z.string().max(1000),
              })
              .strict(),
          })
          .strict()
      )
      .max(50)
      .optional(),
    ai: z
      .object({
        baseUrl: z.string().max(2048),
        model: z.string().max(200),
        apiKey: z.string().max(2000),
      })
      .strict(),
    preferences: z
      .object({
        autoLockMinutes: z.number().int().min(1).max(60),
        historyLimit: z.number().int().min(1).max(100),
      })
      .strict(),
  })
  .strict()
export function validateVault(value: unknown): VaultData {
  const data = vaultSchema.parse(value)
  if (
    new Set(data.accounts.map((a) => a.id)).size !== data.accounts.length ||
    new Set(data.subjects.map((s) => s.id)).size !== data.subjects.length
  )
    throw new Error('账号或主体标识重复，无法导入')
  if (
    data.accounts.some(
      (a) => a.subjectId && !data.subjects.some((s) => s.id === a.subjectId)
    )
  )
    throw new Error('账号关联的主体不存在')
  return data
}
