import { z } from 'zod'
import { captureItemSchema, searchPlanSchema } from './protocol.js'
import { containsLabeledSecret } from './text-safety.js'

export const MAX_CHAT_TURNS = 32
export const MAX_CHAT_CHARACTERS = 24000
export const chatFieldSchema = z.enum([
  'platform',
  'username',
  'subject',
  'target',
  'details',
  'criteria',
])
export type ChatField = z.infer<typeof chatFieldSchema>
export const chatItemSchema = captureItemSchema.extend({
  draftId: z.string().min(1).max(100).optional(),
  target: z
    .object({
      platform: z.string().max(200),
      username: z.string().max(320).optional(),
      subject: z.string().max(200).optional(),
    })
    .strict()
    .optional(),
})
export type ChatItem = z.infer<typeof chatItemSchema>
export const chatTurnSchema = z
  .object({
    text: z.string().trim().min(1).max(6000),
    field: chatFieldSchema.optional(),
    itemIndex: z.number().int().min(0).max(19).optional(),
  })
  .strict()
export type ChatTurn = z.infer<typeof chatTurnSchema>
export const aiConfigSchema = z
  .object({
    baseUrl: z.string().url().max(2048),
    model: z.string().min(1).max(200),
    apiKey: z.string().min(1).max(2000),
  })
  .strict()
export const chatContextSchema = z
  .object({
    items: z.array(chatItemSchema).max(20),
    plan: searchPlanSchema.nullable(),
  })
  .strict()
export type ChatContext = z.infer<typeof chatContextSchema>
export const chatRequestSchema = z
  .object({
    mode: z.enum(['capture', 'search']),
    turns: z.array(chatTurnSchema).min(1).max(MAX_CHAT_TURNS),
    context: chatContextSchema,
    categories: z.array(z.string().max(100)).max(1000),
    config: aiConfigSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.turns.reduce((sum, turn) => sum + turn.text.length, 0) <=
      MAX_CHAT_CHARACTERS,
    '本次对话较长，请先保存草稿或开始新对话'
  )
export type ChatRequest = z.infer<typeof chatRequestSchema>
export const chatResponseSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('capture'),
      reply: z.string().max(1200),
      items: z.array(chatItemSchema).min(1).max(20),
    })
    .strict(),
  z
    .object({
      mode: z.literal('search'),
      reply: z.string().max(1200),
      plan: searchPlanSchema,
    })
    .strict(),
])
export type ChatResponse = z.infer<typeof chatResponseSchema>

// Validate only conversation data; connection credentials are never conversation content.
export function assertChatSafe(value: unknown) {
  if (typeof value === 'string' && containsLabeledSecret(value))
    throw new Error('密码或密钥请填写在安全字段中，不要放进聊天消息')
  if (Array.isArray(value)) value.forEach(assertChatSafe)
  else if (value && typeof value === 'object')
    Object.values(value).forEach(assertChatSafe)
}
