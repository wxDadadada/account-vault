import {
  type ChatContext,
  type ChatField,
  type ChatItem,
  type ChatResponse,
  type ChatTurn,
} from '../../../shared/ai-chat'
import { type SearchPlan } from '../../../shared/protocol'
import {
  canonicalPlatform,
  executeSearch,
  findSubject,
  parseLocalCapture,
  parseLocalSearch,
} from './ai-local'
import { saveAccount, saveSubject } from './domain'
import { blankAccount, type Account, type VaultData } from './model'
import { accountSchema } from './validation'

export type Draft = {
  id: string
  item: ChatItem
  original: Account | null
  account: Account
  subjectName: string
  subjectConfirmed: boolean
  needsTarget: boolean
  passwordEdited?: boolean
}
export type Question = {
  field: ChatField
  text: string
  itemIndex?: number
  choices: string[]
  targets?: Account[]
}
const editableFields = [
  'username',
  'category',
  'tags',
  'email',
  'phone',
  'url',
  'notes',
  'loginMethod',
  'status',
] as const
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function requestText(text: string) {
  return text.replace(
    /^(?:(?:请帮我|麻烦你?|帮我|请|我想要?|我需要)\s*)+(?=查|找|搜索|查看|显示|列出|记录|记一下|记一个|新增|添加|录入|更新|修改)/,
    ''
  )
}

export function inferChatMode(text: string, mode: 'capture' | 'search') {
  const value = requestText(text)
  if (/^(?:查找|查询|查一下|找出|搜索|找一下|查看|显示所有|列出)/.test(value))
    return 'search'
  if (
    /^(?:记录|记一下|记一个|新增|添加|录入|更新|修改)/.test(value) &&
    !/修改过/.test(value)
  )
    return 'capture'
  return mode
}

export function targetCandidates(item: ChatItem, data: VaultData) {
  const target = item.target ?? item
  if (!target.platform && !target.username && !target.subject) return []
  const subject = findSubject(target.subject, data.subjects)
  return data.accounts.filter(
    (a) =>
      (!target.platform ||
        canonicalPlatform(a.platform) === canonicalPlatform(target.platform)) &&
      (!target.username ||
        a.username.toLowerCase() === target.username.toLowerCase()) &&
      (!target.subject || a.subjectId === subject?.id)
  )
}

export function draftFor(
  item: ChatItem,
  data: VaultData,
  defaultSubject: string,
  target?: Account,
  previous?: Draft
): Draft {
  const matches = targetCandidates(item, data)
  const bound =
    previous?.original && same(previous.item.target, item.target)
      ? previous.original
      : undefined
  const original =
    target ??
    bound ??
    ((item.action === 'update' || item.username) && matches.length === 1
      ? matches[0]
      : null)
  const carry =
    previous && (previous.original?.id ?? null) === (original?.id ?? null)
  const base = carry
    ? previous.account
    : (original ?? blankAccount(defaultSubject !== 'all' ? defaultSubject : ''))
  const account = { ...base }
  if (!previous || item.platform !== previous.item.platform)
    account.platform = item.platform || base.platform
  for (const field of editableFields) {
    const value = item[field]
    if (value !== undefined && (!carry || !same(value, previous.item[field])))
      Object.assign(account, { [field]: value })
  }
  let subjectName = carry ? previous.subjectName : (item.subject ?? '')
  if (
    item.subject !== undefined &&
    (!carry || item.subject !== previous.item.subject)
  ) {
    const subject = findSubject(item.subject, data.subjects)
    account.subjectId = item.subject.trim() ? (subject?.id ?? '__new__') : ''
    subjectName = item.subject
  }
  const id = item.draftId ?? previous?.id ?? crypto.randomUUID()
  if (previous?.passwordEdited) account.password = previous.account.password
  return {
    id,
    item: { ...item, draftId: id },
    original,
    account,
    subjectName,
    subjectConfirmed:
      item.subject !== undefined ||
      !!original ||
      defaultSubject !== 'all' ||
      !!(carry && previous.subjectConfirmed),
    needsTarget: item.action === 'update' && !original,
    passwordEdited: previous?.passwordEdited,
  }
}

export function materializeDrafts(
  items: ChatItem[],
  data: VaultData,
  defaultSubject: string,
  previous: Draft[] = []
) {
  const ids = items.flatMap((item) => (item.draftId ? [item.draftId] : []))
  if (new Set(ids).size !== ids.length)
    throw new Error('回复重复引用了同一张草稿，请重试')
  if (
    previous.length &&
    items.some((item) => !item.draftId) &&
    !previous.every((draft) => ids.includes(draft.id))
  )
    throw new Error('AI 未保留草稿标识，原内容已保留，请重试或切换本地助手')
  return items.map((item) =>
    draftFor(
      item,
      data,
      defaultSubject,
      undefined,
      previous.find((d) => d.id === item.draftId)
    )
  )
}

export function captureQuestion(
  drafts: Draft[],
  data: VaultData
): Question | null {
  for (const [itemIndex, draft] of drafts.entries()) {
    const prefix = drafts.length > 1 ? `第 ${itemIndex + 1} 个账号：` : ''
    if (draft.needsTarget) {
      const candidates = targetCandidates(draft.item, data)
      return {
        field: 'target',
        itemIndex,
        text:
          prefix +
          (candidates.length
            ? '找到了多个可能的记录，要更新哪一个？请选择下方账号，或补充原账号和主体。'
            : '还不能确定要更新的记录。请补充原平台、原账号或所属主体，也可以到核对页面选择。'),
        choices: [],
        targets: candidates,
      }
    }
    if (!draft.account.platform.trim())
      return {
        field: 'platform',
        itemIndex,
        text: prefix + '要记录的是哪个平台？',
        choices: ['GitHub', '阿里云', '腾讯云'],
      }
    if (!draft.account.username.trim())
      return {
        field: 'username',
        itemIndex,
        text:
          prefix +
          `「${draft.account.platform}」的账号或登录标识是什么？可以是用户名、邮箱或手机号。`,
        choices: [],
      }
    if (!draft.subjectConfirmed)
      return {
        field: 'subject',
        itemIndex,
        text: prefix + '这个账号属于谁？选择已有主体，或输入一个新主体名称。',
        choices: [...data.subjects.slice(0, 6).map((s) => s.name), '暂不分配'],
      }
  }
  return null
}

export function patchDraft(
  draft: Draft,
  values: Partial<Account>,
  data: VaultData
): Draft {
  const item = { ...draft.item }
  for (const field of ['platform', ...editableFields] as const) {
    const value = values[field]
    if (value !== undefined) Object.assign(item, { [field]: value })
  }
  if (values.subjectId !== undefined && values.subjectId !== '__new__')
    item.subject =
      data.subjects.find((s) => s.id === values.subjectId)?.name ?? ''
  return {
    ...draft,
    item,
    account: { ...draft.account, ...values },
    passwordEdited: values.password !== undefined || draft.passwordEdited,
    subjectConfirmed: values.subjectId !== undefined || draft.subjectConfirmed,
  }
}

export function saveDrafts(
  current: VaultData,
  drafts: Draft[],
  source: 'manual' | 'ai'
) {
  // Stage the whole batch independently so a later validation failure cannot
  // leave earlier accounts or newly created subjects in the caller's data.
  current = structuredClone(current)
  if (!drafts.length) throw new Error('还没有要保存的账号')
  const question = captureQuestion(drafts, current)
  if (question) throw new Error(question.text)
  const updatedIds = drafts.flatMap((d) => (d.original ? [d.original.id] : []))
  if (new Set(updatedIds).size !== updatedIds.length)
    throw new Error('同一批中重复更新了同一个账号，请合并成一张卡片')
  for (const draft of drafts) {
    let subjectId = draft.account.subjectId
    if (subjectId === '__new__') {
      if (!draft.subjectName.trim()) throw new Error('请填写新主体名称')
      const existing = findSubject(draft.subjectName, current.subjects)
      if (existing) subjectId = existing.id
      else {
        subjectId = crypto.randomUUID()
        current = saveSubject(current, {
          id: subjectId,
          name: draft.subjectName.trim(),
          type: 'company',
          aliases: [],
          color: 'blue',
        })
      }
    }
    const account = {
      ...draft.account,
      subjectId,
      tags: [
        ...new Set(draft.account.tags.map((t) => t.trim()).filter(Boolean)),
      ],
    }
    const parsed = accountSchema.safeParse(account)
    if (!parsed.success)
      throw new Error(
        parsed.error.issues[0].path[0] === 'url'
          ? '请填写完整的 http 或 https 登录地址'
          : '请检查账号字段，部分内容为空或过长'
      )
    current = saveAccount(current, parsed.data, source, draft.original)
  }
  return current
}

function answerValue(text: string) {
  return text
    .replace(/^(?:是|用的是|应该是|改为|改成|换成|更正为)\s*/, '')
    .replace(/[。！!]$/, '')
    .trim()
}
function localCapture(
  turn: ChatTurn,
  current: ChatItem[],
  data: VaultData
): ChatItem[] {
  if (!current.length)
    return parseLocalCapture(turn.text, data).map((item) => {
      if (
        item.email &&
        !/(?:账号|用户名|登录名)\s*(?:是|为|[:：=])/.test(turn.text)
      )
        delete item.username
      return item
    })
  const items = structuredClone(current)
  const number = turn.text.match(
    /^第\s*([1-9]\d?|[一二三四五六七八九十])\s*(?:个|条|张)/
  )?.[1]
  const explicitIndex = number
    ? /^\d+$/.test(number)
      ? Number(number) - 1
      : '一二三四五六七八九十'.indexOf(number)
    : undefined
  const index = explicitIndex ?? turn.itemIndex ?? 0
  if (!items[index]) throw new Error('没有找到这张草稿，请使用已有账号的序号')
  const input = turn.text.replace(
    /^第\s*([1-9]\d?|[一二三四五六七八九十])\s*(?:个|条|张)[：:,，\s]*/,
    ''
  )
  if (/^(?:另外|再新增|再添加|再记|再录入)/.test(input)) {
    const added = parseLocalCapture(input, data)
    if (items.length + added.length > 20)
      throw new Error('一次最多整理 20 个账号，请先保存当前草稿')
    return [
      ...items,
      ...added.map((item) => ({ ...item, draftId: crypto.randomUUID() })),
    ]
  }
  const item = items[index]
  const bare =
    !/(?:平台|账号|用户名|登录名|主体|属于|归属|标签|邮箱|手机|网址|地址|备注|用于|状态|方式|不是|改成|改为)/.test(
      input
    )
  if (turn.field === 'subject' && (bare || input === '暂不分配')) {
    item.subject =
      input === '暂不分配'
        ? ''
        : (findSubject(answerValue(input), data.subjects)?.name ??
          answerValue(input))
    return items
  }
  if (turn.field === 'username' && bare) {
    item.username = answerValue(input)
    return items
  }
  if (turn.field === 'platform' && bare) {
    const parsed = parseLocalCapture(input, data)[0]
    item.platform = parsed.platform || answerValue(input)
    if (parsed.category) item.category = parsed.category
    return items
  }
  const corrected = input.match(
    /^(?:平台(?:名称)?\s*(?:改为|改成|换成|是|为|[:：])|不是.+?(?:而是|是))\s*(.+)$/
  )?.[1]
  const parsed = parseLocalCapture(corrected ?? input, data)
  if (parsed.length !== 1)
    throw new Error('请一次补充一张草稿，也可以用“第 2 个”指定要修改的账号')
  const next = parsed[0]
  if (turn.field === 'target') {
    const target = { ...(item.target ?? { platform: item.platform }) }
    if (next.platform) target.platform = next.platform
    if (next.username) target.username = next.username
    if (next.subject) target.subject = next.subject
    item.target = target
    return items
  }
  if (corrected) item.platform = next.platform || answerValue(corrected)
  else if (next.platform) item.platform = next.platform
  for (const field of [...editableFields, 'subject'] as const) {
    if (next[field] === undefined) continue
    // An explicitly bound email is not a change to the login identifier.
    if (
      field === 'username' &&
      next.email &&
      !/(?:账号|用户名|登录名)/.test(input)
    )
      continue
    Object.assign(item, { [field]: next[field] })
  }
  const username = input.match(
    /(?:账号|用户名|登录名)\s*(?:改为|改成|换成|更正为)\s*(\S+)/
  )?.[1]
  if (username) item.username = username.replace(/[，,。].*$/, '')
  const notes = input.match(
    /(?:备注|用途)\s*(?:改为|改成|换成|是|为|[:：])\s*(.+)/
  )?.[1]
  if (notes) item.notes = notes
  if (/不限主体|暂不分配/.test(input)) item.subject = ''
  const clearFields = {
    备注: 'notes',
    邮箱: 'email',
    手机: 'phone',
    登录地址: 'url',
    标签: 'tags',
  } as const
  for (const [label, field] of Object.entries(clearFields))
    if (new RegExp(`(?:清空|删除|去掉)${label}`).test(input))
      Object.assign(item, { [field]: field === 'tags' ? [] : '' })
  return items
}

export function refineLocalSearch(
  text: string,
  previous: SearchPlan | null,
  data: VaultData,
  now = new Date()
): SearchPlan {
  text = requestText(text)
  if (
    /^(?:查看|查找|查询|显示|列出)?(?:全部|所有)账号[。？?]?$/.test(text.trim())
  )
    return { keywords: [] }
  const clearSubject = /(?:不限|不限制|取消|清除)(?:所属)?主体|所有主体/.test(
    text
  )
  const clearTime = /(?:不限|不限制|取消|清除)(?:时间|日期)|所有时间/.test(text)
  const clearStatus = /(?:不限|不限制|取消|清除)状态|所有状态/.test(text)
  const clearFavorite = /(?:不限|不限制|取消|清除)收藏|不只(?:看)?收藏/.test(
    text
  )
  const clearCategory = /(?:不限|不限制|取消|清除)分类|所有分类/.test(text)
  const clearChange = /(?:不限|不限制|取消|清除)变更(?:字段)?/.test(text)
  const active = /使用中|正在用|正常使用/.test(text)
  const negativeFavorite = /未收藏|没收藏|不收藏的/.test(text)
  const criteria = text
    .replace(/^(?:查一下|查看|列出|显示)\s*/, '')
    .replace(
      /(?:不限|不限制|取消|清除)(?:所属)?(?:主体|时间|日期|状态|收藏|分类|变更(?:字段)?)|所有(?:主体|时间|状态|分类)|不只(?:看)?收藏/g,
      ''
    )
    .replace(/使用中|正在用|正常使用|未收藏|没收藏|不收藏的/g, '')
    .replace(/只看|只要|仅看|仅要|再加上|也要包含|标签加上/g, '')
    .replace(/[，,。？?]/g, ' ')
    .replace(/(?:的|即可|就行)\s*$/, '')
    .trim()
  const next = parseLocalSearch(criteria, data, now)
  const plan: SearchPlan = {
    ...(previous ?? { keywords: [] }),
    ...next,
    keywords: next.keywords.length ? next.keywords : (previous?.keywords ?? []),
  }
  if (/再加上|也要包含|标签加上/.test(text))
    plan.keywords = [
      ...new Set([...(previous?.keywords ?? []), ...next.keywords]),
    ]
  if (next.updatedAfter && !next.updatedBefore) delete plan.updatedBefore
  if (clearSubject) delete plan.subject
  if (clearTime) {
    delete plan.updatedAfter
    delete plan.updatedBefore
  }
  if (clearStatus) delete plan.status
  if (clearFavorite) delete plan.favorite
  if (clearCategory) delete plan.category
  if (clearChange) delete plan.changedField
  if (active) plan.status = 'active'
  if (negativeFavorite) plan.favorite = false
  const replacing = text.match(
    /(?:改查|换成|改为|不是.+?(?:而是|是))\s*(.+)/
  )?.[1]
  if (replacing) plan.keywords = parseLocalSearch(replacing, data, now).keywords
  return plan
}

export function localChat(
  mode: 'capture' | 'search',
  turn: ChatTurn,
  context: ChatContext,
  data: VaultData
): ChatResponse {
  return mode === 'capture'
    ? { mode, reply: '', items: localCapture(turn, context.items, data) }
    : {
        mode,
        reply: '',
        plan: refineLocalSearch(turn.text, context.plan, data),
      }
}

export function searchFeedback(
  plan: SearchPlan,
  data: VaultData,
  text: string
) {
  const results = executeSearch(plan, data)
  const hasCriteria = Object.entries(plan).some(([key, value]) =>
    key === 'keywords' ? plan.keywords.length > 0 : value !== undefined
  )
  const asking = !hasCriteria && !/(?:全部|所有)账号/.test(text)
  const message = asking
    ? '想查哪个平台、主体或时间范围？也可以直接查看全部账号。'
    : !results.length
      ? '暂时没有匹配的账号。可以换个关键词，或放宽主体、时间等条件，我会接着查。'
      : `找到 ${results.length} 个账号。${results.length > 1 ? '还可以补充主体、收藏状态或时间，继续缩小范围。' : '可以打开查看，也可以继续补充查询条件。'}`
  const subjects = [
    ...new Set(
      results
        .map((a) => data.subjects.find((s) => s.id === a.subjectId)?.name)
        .filter((s): s is string => !!s)
    ),
  ]
  return {
    results,
    asking,
    message,
    choices: [
      ...(results.length > 1 && subjects.length > 1
        ? subjects.slice(0, 3).map((s) => `只看${s}`)
        : []),
      ...(plan.subject ? ['不限主体'] : []),
      ...(plan.updatedAfter || plan.updatedBefore ? ['不限时间'] : []),
      ...(plan.category ? ['不限分类'] : []),
      ...(plan.status ? ['不限状态'] : []),
      ...(plan.changedField ? ['不限变更字段'] : []),
      ...(plan.favorite !== undefined
        ? ['不限收藏']
        : hasCriteria && results.length
          ? ['只看收藏']
          : []),
      '查看全部账号',
    ],
  }
}
