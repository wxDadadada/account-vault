import {
  type Account,
  type Change,
  type Subject,
  type VaultData,
  fieldNames,
} from './model'
import {
  assertSubjectIdentities,
  assertSubjectIdentity,
  subjectLabel,
} from './subject-identity'
import { accountSchema, subjectSchema } from './validation'

export function pruneHistory(data: VaultData) {
  const counts = new Map<string, number>()
  data.changes = [...data.changes]
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((c) => {
      const n = (counts.get(c.accountId) ?? 0) + 1
      counts.set(c.accountId, n)
      return n <= data.preferences.historyLimit
    })
  return data
}
export function sameAccount(
  a: Account | undefined | null,
  b: Account | undefined | null
) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}
export function duplicateAccount(data: VaultData, account: Account) {
  return data.accounts.find(
    (a) =>
      a.id !== account.id &&
      a.subjectId === account.subjectId &&
      a.platform.toLowerCase() === account.platform.toLowerCase() &&
      a.username === account.username &&
      a.url === account.url
  )
}
export function saveAccount(
  data: VaultData,
  input: Account,
  source: Change['source'] = 'manual',
  expected?: Account | null,
  action?: Change['action']
): VaultData {
  const before = data.accounts.find((a) => a.id === input.id) ?? null
  if (expected !== undefined && !sameAccount(before, expected))
    throw new Error('这个账号已发生变化，请关闭编辑面板后重新核对最新信息')
  const now = new Date().toISOString()
  const after = accountSchema.parse({
    ...input,
    createdAt: before?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
    tags: [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))],
  })
  if (after.subjectId && !data.subjects.some((s) => s.id === after.subjectId))
    throw new Error('所属主体不存在，请重新选择')
  if (duplicateAccount(data, after))
    throw new Error('同一主体下已经有相同平台、账号和登录地址，请编辑已有记录')
  const fields = Object.keys(fieldNames).filter(
    (key) =>
      !before ||
      JSON.stringify(before[key as keyof Account]) !==
        JSON.stringify(after[key as keyof Account])
  )
  if (!fields.length && !action) return data
  data.accounts = before
    ? data.accounts.map((a) => (a.id === after.id ? after : a))
    : [after, ...data.accounts]
  if (!data.categories.includes(after.category))
    data.categories.push(after.category)
  data.changes.unshift({
    id: crypto.randomUUID(),
    accountId: after.id,
    platform: after.platform,
    action: action ?? (before ? 'update' : 'create'),
    at: now,
    source,
    fields,
    before,
    after,
  })
  return pruneHistory(data)
}
export function deleteAccount(data: VaultData, account: Account) {
  const existing = data.accounts.find((a) => a.id === account.id)
  if (!sameAccount(existing, account))
    throw new Error('账号已发生变化，请重新打开后操作')
  data.accounts = data.accounts.filter((a) => a.id !== account.id)
  data.changes.unshift({
    id: crypto.randomUUID(),
    accountId: account.id,
    platform: account.platform,
    action: 'delete',
    at: new Date().toISOString(),
    source: 'manual',
    fields: [],
    before: account,
    after: null,
  })
  return pruneHistory(data)
}
export function saveSubject(data: VaultData, input: Subject) {
  const subject = subjectSchema.parse(input)
  assertSubjectIdentity(subject, data.subjects)
  const exists = data.subjects.some((s) => s.id === subject.id)
  data.subjects = exists
    ? data.subjects.map((s) => (s.id === subject.id ? subject : s))
    : [...data.subjects, subject]
  return data
}
export function deleteSubject(data: VaultData, id: string) {
  if (
    data.accounts.some((a) => a.subjectId === id) ||
    data.changes.some(
      (c) => c.before?.subjectId === id || c.after?.subjectId === id
    )
  )
    throw new Error(
      '该主体仍关联账号或历史记录，可以修改名称；清理关联记录后才能删除'
    )
  data.subjects = data.subjects.filter((s) => s.id !== id)
  return data
}
export function mergeBackup(current: VaultData, imported: VaultData) {
  assertSubjectIdentities(imported.subjects)
  // Plan every identity before changing accounts or history, including on failure.
  const subjects = structuredClone(current.subjects)
  const subjectMap = new Map<string, string>()
  for (const s of imported.subjects) {
    const matches = subjects.filter(
      (item) => subjectLabel(item.name) === subjectLabel(s.name)
    )
    const match = matches[0]
    if (match) {
      if (matches.length !== 1 || match.type !== s.type)
        throw new Error(`主体「${s.name}」名称重复或类型不同，请修改后重试`)
      assertSubjectIdentity(match, subjects)
      subjectMap.set(s.id, match.id)
    } else {
      const id = crypto.randomUUID()
      const subject = subjectSchema.parse({ ...s, id })
      assertSubjectIdentity(subject, subjects)
      subjectMap.set(s.id, id)
      subjects.push(subject)
    }
  }
  current = {
    ...current,
    subjects,
    accounts: [...current.accounts],
    changes: [...current.changes],
    categories: [...current.categories],
  }
  let added = 0
  for (const account of imported.accounts) {
    const restored = {
      ...account,
      id: crypto.randomUUID(),
      subjectId: subjectMap.get(account.subjectId) ?? '',
    }
    if (duplicateAccount(current, restored)) continue
    current = saveAccount(current, restored, 'import')
    const remapSnapshot = (snapshot: Account | null) =>
      snapshot
        ? {
            ...snapshot,
            id: restored.id,
            subjectId: subjectMap.get(snapshot.subjectId) ?? '',
          }
        : null
    current.changes.push(
      ...imported.changes
        .filter((c) => c.accountId === account.id)
        .map((c) => ({
          ...c,
          id: crypto.randomUUID(),
          accountId: restored.id,
          before: remapSnapshot(c.before),
          after: remapSnapshot(c.after),
        }))
    )
    added++
  }
  current.categories = [
    ...new Set([...current.categories, ...imported.categories]),
  ]
  return {
    data: pruneHistory(current),
    added,
    skipped: imported.accounts.length - added,
  }
}
