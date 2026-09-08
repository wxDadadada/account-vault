import { platformSearchTerms } from './ai-local'
import { deleteAccount, saveAccount } from './domain'
import { type Account, type CollectionFilter, type VaultData } from './model'

export const defaultFilter = (): CollectionFilter => ({
  subject: 'all',
  category: 'all',
  status: 'all',
  favorite: false,
  tags: [],
  issue: 'all',
  query: '',
})
export const issueNames = {
  missing: '资料待补全',
  weak: '密码较弱',
  reused: '密码重复',
  due: '即将或已经到期',
}
export type AccountIssue = { type: keyof typeof issueNames; reason: string }

export function daysUntil(date: string, now = new Date()) {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      86400000
  )
}
export function expiryLabel(account: Account, now = new Date()) {
  if (!account.expiresOn) return ''
  const days = daysUntil(account.expiresOn, now)
  return days < 0
    ? `已到期 ${-days} 天`
    : days === 0
      ? '今天到期'
      : `${days} 天后到期`
}
export function accountIssues(accounts: Account[], now = new Date()) {
  const passwords = new Map<string, number>()
  for (const account of accounts)
    if (account.password && account.status !== 'inactive')
      passwords.set(
        account.password,
        (passwords.get(account.password) ?? 0) + 1
      )
  return new Map(
    accounts.map((account) => {
      const issues: AccountIssue[] = []
      if (account.status === 'inactive') return [account.id, issues] as const
      const missing = [
        !account.subjectId && '所属主体',
        !account.url && '登录地址',
        account.loginMethod === '密码登录' && !account.password && '密码',
      ].filter(Boolean)
      if (missing.length || account.status === 'pending')
        issues.push({
          type: 'missing',
          reason: missing.length
            ? `待补充：${missing.join('、')}`
            : '已标记为待完善',
        })
      if (
        account.password &&
        (account.password.length < 12 ||
          /^(.)\1+$/.test(account.password) ||
          /^(?:password|123456|qwerty|admin|letmein)[\d!@#$]*$/i.test(
            account.password
          ))
      )
        issues.push({
          type: 'weak',
          reason: '密码不足 12 个字符，或命中常见／重复字符模式',
        })
      if ((passwords.get(account.password) ?? 0) > 1)
        issues.push({
          type: 'reused',
          reason: `与其他 ${(passwords.get(account.password) ?? 1) - 1} 个使用中的账号共用密码`,
        })
      if (
        account.expiresOn &&
        daysUntil(account.expiresOn, now) <= (account.reminderDays ?? 7)
      )
        issues.push({
          type: 'due',
          reason: `${expiryLabel(account, now)}（${account.expiresOn}）`,
        })
      return [account.id, issues] as const
    })
  )
}
export function filterAccounts(
  data: VaultData,
  filter: CollectionFilter,
  issues = accountIssues(data.accounts)
) {
  const subjects = new Map(data.subjects.map((s) => [s.id, s]))
  return data.accounts.filter((a) => {
    const owner = subjects.get(a.subjectId)
    // Secret custom fields and TOTP seeds are deliberately excluded from search.
    const haystack =
      `${platformSearchTerms(a.platform)} ${a.alias ?? ''} ${a.username} ${a.tags.join(' ')} ${a.category} ${a.notes} ${a.email} ${a.phone} ${owner?.name ?? ''} ${owner?.aliases.join(' ') ?? ''} ${(
        a.customFields ?? []
      )
        .filter((f) => !f.secret)
        .map((f) => `${f.label} ${f.value}`)
        .join(' ')}`.toLowerCase()
    return (
      (filter.subject === 'all' || a.subjectId === filter.subject) &&
      (filter.category === 'all' || a.category === filter.category) &&
      (filter.status === 'all' || a.status === filter.status) &&
      (!filter.favorite || a.favorite) &&
      filter.tags.every((tag) => a.tags.includes(tag)) &&
      (filter.issue === 'all' ||
        issues.get(a.id)?.some((i) => i.type === filter.issue)) &&
      filter.query
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .every((q) => haystack.includes(q))
    )
  })
}

export type BulkPatch = {
  subjectId?: string
  category?: string
  status?: Account['status']
  favorite?: boolean
  addTags?: string[]
  removeTags?: string[]
}
export function bulkUpdate(
  data: VaultData,
  expected: Account[],
  patch: BulkPatch
) {
  let next = structuredClone(data)
  for (const account of expected) {
    const { addTags = [], removeTags = [], ...fields } = patch
    next = saveAccount(
      next,
      {
        ...account,
        ...fields,
        tags: [...new Set([...account.tags, ...addTags])].filter(
          (t) => !removeTags.includes(t)
        ),
      },
      'manual',
      account
    )
  }
  return next
}
export function bulkDelete(data: VaultData, expected: Account[]) {
  let next = structuredClone(data)
  for (const account of expected) next = deleteAccount(next, account)
  return next
}

// The existing encrypted deletion history is the source of truth, including old vaults.
export function trashEntries(data: VaultData) {
  const live = new Set(data.accounts.map((a) => a.id))
  const seen = new Set<string>()
  return [...data.changes]
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((change) => {
      if (live.has(change.accountId) || seen.has(change.accountId)) return false
      seen.add(change.accountId)
      return change.action === 'delete' && !!change.before
    })
    .map((c) => ({ account: c.before!, deletedAt: c.at }))
}
export function restoreDeleted(data: VaultData, expected: Account[]) {
  let next = structuredClone(data)
  for (const account of expected) {
    const entry = trashEntries(next).find((e) => e.account.id === account.id)
    if (!entry || JSON.stringify(entry.account) !== JSON.stringify(account))
      throw new Error('回收站已发生变化，请刷新后重试')
    next = saveAccount(next, account, 'manual', null, 'restore')
  }
  return next
}
export function purgeDeleted(data: VaultData, expected: Account[]) {
  const trash = trashEntries(data)
  for (const account of expected)
    if (
      !trash.some((e) => JSON.stringify(e.account) === JSON.stringify(account))
    )
      throw new Error('回收站已发生变化，请刷新后重试')
  const ids = new Set(expected.map((a) => a.id))
  return { ...data, changes: data.changes.filter((c) => !ids.has(c.accountId)) }
}
