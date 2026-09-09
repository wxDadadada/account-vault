import {
  chatResponseSchema,
  type ChatItem,
  type ChatRequest,
} from '../shared/ai-chat.js'
import { ModelOutputError } from './ai-provider.js'

const optionalItemFields = [
  'action',
  'username',
  'subject',
  'category',
  'tags',
  'email',
  'phone',
  'url',
  'notes',
  'loginMethod',
  'status',
  'draftId',
  'target',
]
const optionalPlanFields = [
  'keywords',
  'subject',
  'category',
  'favorite',
  'status',
  'updatedAfter',
  'updatedBefore',
  'changedField',
]
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
function omitNulls(value: unknown, fields: string[]) {
  const result = object(value)
  if (!result) return value
  const normalized = { ...result }
  for (const field of fields)
    if (normalized[field] === null) delete normalized[field]
  return normalized
}
const equal = (a: string | undefined, b: string | undefined) =>
  !!a?.trim() && a.trim().toLowerCase() === b?.trim().toLowerCase()

export function validateChatOutput(value: unknown, input: ChatRequest) {
  const original = object(value)
  const fail = (message: string): never => {
    throw new ModelOutputError(message, JSON.stringify(value) ?? '')
  }
  if (!original) return fail('回复必须是 JSON 对象')
  const normalized = { ...original }
  // Compatible models sometimes return the one-shot envelope or explicit nulls.
  // Unknown keys and invalid actions still go through the strict schemas.
  if (normalized.mode == null) normalized.mode = input.mode
  if (normalized.reply == null) normalized.reply = ''
  if (Array.isArray(normalized.items)) {
    normalized.items = normalized.items.map((item) => {
      const next = omitNulls(item, optionalItemFields)
      const record = object(next)
      if (record?.target)
        record.target = omitNulls(record.target, ['username', 'subject'])
      return next
    })
    if (!(normalized.items as unknown[]).length && !input.context.items.length)
      normalized.items = [{ platform: '' }]
  }
  if (normalized.plan)
    normalized.plan = omitNulls(normalized.plan, optionalPlanFields)
  const parsed = chatResponseSchema.safeParse(normalized)
  if (!parsed.success) {
    const paths = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join('.')}: ${issue.code}`)
      .join('; ')
    return fail(`回复结构不符合要求（${paths}）`)
  }
  if (parsed.data.mode !== input.mode) return fail('回复模式必须与请求模式一致')
  if (parsed.data.mode !== 'capture') return parsed.data

  const previous = input.context.items.filter((item) => !!item.draftId)
  const known = new Map(previous.map((item) => [item.draftId!, item]))
  const used = new Set<string>()
  const items: ChatItem[] = parsed.data.items.map((item) => {
    if (!item.draftId || !known.has(item.draftId)) {
      const next = { ...item }
      delete next.draftId
      return next
    }
    if (used.has(item.draftId)) return fail('同一个 draftId 只能出现一次')
    used.add(item.draftId)
    return item
  })
  for (const item of items.filter((item) => !item.draftId)) {
    const matches = previous.filter(
      (prior) =>
        !used.has(prior.draftId!) &&
        equal(prior.platform, item.platform) &&
        equal(prior.username, item.username)
    )
    if (matches.length === 1) {
      item.draftId = matches[0].draftId
      used.add(item.draftId!)
    }
  }
  const unbound = items.filter((item) => !item.draftId)
  const missing = previous.filter((item) => !used.has(item.draftId!))
  const lastTurn = input.turns[input.turns.length - 1]
  if (
    unbound.length === 1 &&
    missing.length === 1 &&
    lastTurn.itemIndex !== undefined &&
    input.context.items[lastTurn.itemIndex]?.draftId === missing[0].draftId &&
    ['platform', 'username', 'subject'].includes(lastTurn.field ?? '')
  ) {
    unbound[0].draftId = missing[0].draftId
    used.add(missing[0].draftId!)
  }
  if (previous.some((item) => !used.has(item.draftId!)))
    return fail(
      '必须原样保留全部已有 draftId，不能丢失或替换草稿；仅新草稿省略 draftId'
    )
  const merged = items.map((item) => {
    const prior = item.draftId ? known.get(item.draftId) : undefined
    return prior ? { ...prior, ...item, action: prior.action } : item
  })
  return chatResponseSchema.parse({ ...parsed.data, items: merged })
}
