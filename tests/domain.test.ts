import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  executeSearch,
  findSubject,
  parseLocalCapture,
  parseLocalSearch,
} from '../src/vault/lib/ai-local'
import { demoVault } from '../src/vault/lib/demo'
import {
  deleteAccount,
  deleteSubject,
  mergeBackup,
  saveAccount,
  saveSubject,
} from '../src/vault/lib/domain'
import { emptyVault } from '../src/vault/lib/model'
import { validateVault } from '../src/vault/lib/validation'
import { fixtureAccount, fixtureVault } from './fixtures'

test('create, edit, delete and restore produce useful immutable account history', () => {
  let data = emptyVault()
  const account = fixtureAccount(data.subjects[0].id)
  data = saveAccount(data, account, 'manual', null)
  const original = structuredClone(data.accounts[0])
  data = saveAccount(
    data,
    { ...original, password: 'ROTATED_PASSWORD', phone: '13800005678' },
    'manual',
    original
  )
  assert.deepEqual(data.changes[0].fields.sort(), ['password', 'phone'])
  assert.equal(data.changes[0].before?.password, original.password)
  const newer = data.accounts[0]
  data = deleteAccount(data, newer)
  assert.equal(data.accounts.length, 0)
  data = saveAccount(data, newer, 'manual', null, 'restore')
  assert.equal(data.accounts[0].password, 'ROTATED_PASSWORD')
  assert.equal(data.changes[0].action, 'restore')
  assert.equal(validateVault(data).accounts.length, 1)
})
test('stale editors and duplicate identities cannot overwrite account data', () => {
  let data = fixtureVault()
  const stale = structuredClone(data.accounts[0])
  data = saveAccount(data, { ...stale, phone: 'other' })
  assert.throws(
    () => saveAccount(data, { ...stale, notes: 'stale' }, 'manual', stale),
    /已发生变化/
  )
  assert.throws(
    () => saveAccount(data, { ...data.accounts[0], id: crypto.randomUUID() }),
    /已经有相同/
  )
  const secondSubject = crypto.randomUUID()
  data = saveSubject(data, {
    id: secondSubject,
    name: '第二公司',
    aliases: [],
    type: 'company',
    color: 'blue',
  })
  data = saveAccount(data, {
    ...data.accounts[0],
    id: crypto.randomUUID(),
    subjectId: secondSubject,
  })
  assert.equal(data.accounts.length, 2)
})
test('history retention is per account and never mutates previous snapshots', () => {
  let data = fixtureVault()
  data.preferences.historyLimit = 5
  for (let i = 0; i < 10; i++) {
    data = structuredClone(data)
    data = saveAccount(data, { ...data.accounts[0], password: `pass-${i}` })
  }
  assert.equal(data.changes.length, 5)
  assert.equal(data.changes[0].after?.password, 'pass-9')
  assert.equal(data.changes[4].after?.password, 'pass-5')
})
test('subject aliases are unambiguous and subjects referenced by history are retained', () => {
  let data = fixtureVault()
  data = saveSubject(data, {
    id: 'company',
    name: '星河科技',
    aliases: ['星河'],
    type: 'company',
    color: 'blue',
  })
  assert.throws(
    () =>
      saveSubject(data, {
        id: 'other',
        name: '星河',
        aliases: [],
        type: 'company',
        color: 'green',
      }),
    /重复/
  )
  const account = data.accounts[0]
  data = deleteAccount(data, account)
  assert.throws(() => deleteSubject(data, account.subjectId), /历史/)
})
test('backup merge retains history, remaps IDs, skips duplicates and preserves current AI credentials', () => {
  const target = emptyVault()
  target.ai.apiKey = 'CURRENT_PRIVATE_PROVIDER_KEY'
  let imported = emptyVault()
  imported = saveAccount(imported, fixtureAccount(imported.subjects[0].id))
  imported = saveAccount(imported, {
    ...imported.accounts[0],
    password: 'OLD_BACKUP_CHANGED_PASSWORD',
  })
  imported.ai.apiKey = 'FOREIGN_PROVIDER_KEY'
  const merged = mergeBackup(target, imported)
  assert.equal(merged.added, 1)
  assert.equal(merged.data.ai.apiKey, 'CURRENT_PRIVATE_PROVIDER_KEY')
  assert.notEqual(merged.data.accounts[0].id, imported.accounts[0].id)
  assert.equal(merged.data.changes.length, 3)
  assert.equal(validateVault(merged.data).accounts.length, 1)
  assert.equal(mergeBackup(merged.data, imported).skipped, 1)
})
test('backup merge rejects cross-subject name/alias collisions before changing any data', () => {
  const current = fixtureVault()
  current.subjects.push({
    id: 'company',
    name: '星河科技',
    aliases: ['星河', 'ACME'],
    type: 'company',
    color: 'blue',
  })
  for (const fields of [
    { name: '星河', aliases: [] },
    { name: 'acme', aliases: [] },
    { name: '独立公司', aliases: [' 星河科技 '] },
    { name: '独立公司', aliases: ['AcMe'] },
  ]) {
    const imported = emptyVault()
    imported.subjects.push({
      id: 'other',
      type: 'company',
      color: 'green',
      ...fields,
    })
    const before = structuredClone(current)
    assert.throws(() => mergeBackup(current, imported), /主体.*重复/)
    assert.deepEqual(current, before)
  }
})
test('subject collisions inside a backup are rejected, and legacy ambiguity never selects the first row', () => {
  const imported = fixtureVault()
  imported.subjects.push(
    {
      id: 'a',
      name: '星河科技',
      aliases: ['星河'],
      type: 'company',
      color: 'blue',
    },
    { id: 'b', name: '星河', aliases: [], type: 'company', color: 'green' }
  )
  assert.throws(() => mergeBackup(emptyVault(), imported), /重复/)
  assert.equal(
    validateVault(imported).accounts.length,
    1,
    'legacy data remains readable for manual repair'
  )
  assert.equal(findSubject('星河', imported.subjects), undefined)
  assert.equal(findSubject(' 星河科技 ', imported.subjects)?.id, 'a')
})
test('blank aliases cannot be imported or saved and never match unrelated text in legacy data', () => {
  const legacy = fixtureVault()
  const subject = {
    id: 'blank-alias',
    name: '未提及公司',
    aliases: ['   '],
    type: 'company' as const,
    color: 'blue',
  }
  legacy.subjects.push(subject)
  const readable = validateVault(legacy)
  assert.equal(findSubject('   ', readable.subjects), undefined)
  assert.notEqual(
    parseLocalCapture('GitHub 账号是 owner', readable)[0].subject,
    subject.name
  )
  assert.notEqual(
    parseLocalSearch('查询 GitHub', readable).subject,
    subject.name
  )
  assert.throws(() => mergeBackup(emptyVault(), readable), /不能为空白/)
  assert.throws(() => saveSubject(emptyVault(), subject), /不能为空白/)
  const repaired = saveSubject(readable, { ...subject, aliases: [] })
  assert.doesNotThrow(() => mergeBackup(emptyVault(), repaired))
})
test('backup merge reuses case-insensitive names of the same type and preserves original history links', () => {
  let current = emptyVault()
  current = saveSubject(current, {
    id: 'acme',
    name: 'ACME',
    aliases: ['公司'],
    type: 'company',
    color: 'blue',
  })
  let imported = emptyVault()
  imported = saveSubject(imported, {
    id: 'foreign-acme',
    name: 'acme',
    aliases: [],
    type: 'company',
    color: 'green',
  })
  imported = saveAccount(imported, fixtureAccount('foreign-acme'))
  const merged = mergeBackup(current, imported)
  assert.equal(merged.data.accounts[0].subjectId, 'acme')
  assert.ok(
    merged.data.changes.every((c) => !c.after || c.after.subjectId === 'acme')
  )
  assert.deepEqual(
    merged.data.subjects.find((s) => s.id === 'acme'),
    current.subjects.find((s) => s.id === 'acme')
  )
  assert.equal(
    current.accounts.length,
    0,
    'preview merging does not mutate the current vault'
  )
})
test('unsafe imported URLs and inconsistent subject references are rejected', () => {
  const data = fixtureVault()
  data.accounts[0].url = 'javascript:alert(1)'
  assert.throws(() => validateVault(data))
  data.accounts[0].url = 'https://user:pass@example.com'
  assert.throws(() => validateVault(data))
  data.accounts[0].url = ''
  data.accounts[0].subjectId = 'missing'
  assert.throws(() => validateVault(data), /不存在/)
})
test('local capture recognizes the user example without fabricating login URLs', () => {
  const data = demoVault()
  const items = parseLocalCapture(
    '帮我记录一下，星河科技的阿里云账号是 ops@example.com，用于商城项目，标签加上生产环境。\nGitHub 账号是 hello@example.com，属于我个人',
    data
  )
  assert.equal(items.length, 2)
  assert.equal(items[0].platform, '阿里云')
  assert.equal(items[0].subject, '星河科技')
  assert.equal(items[0].username, 'ops@example.com')
  assert.equal(items[0].url, undefined)
  assert.deepEqual(items[0].tags, ['生产环境'])
  assert.equal(items[1].subject, '我个人')
})
test('natural search interprets China calendar months and inspects change timestamps', () => {
  const data = demoVault()
  const plan = parseLocalSearch(
    '找出上个月修改过密码的账号',
    data,
    new Date('2026-09-08T00:00:00Z')
  )
  assert.equal(plan.updatedAfter, '2026-07-31T16:00:00.000Z')
  assert.equal(plan.updatedBefore, '2026-08-31T16:00:00.000Z')
  data.changes[0].at = '2026-08-10T00:00:00.000Z'
  assert.deepEqual(
    executeSearch(plan, data).map((a) => a.id),
    [data.changes[0].accountId]
  )
  assert.equal(
    executeSearch({ keywords: [], subject: '不存在的公司' }, data).length,
    0
  )
  assert.equal(
    executeSearch(parseLocalSearch('星河科技所有云服务账号', data), data)
      .length,
    2
  )
})
test('search date bounds handle ISO strings with and without fractional seconds', () => {
  const data = fixtureVault()
  data.accounts[0].updatedAt = '2026-08-01T00:00:00.000Z'
  assert.equal(
    executeSearch({ keywords: [], updatedAfter: '2026-08-01T00:00:00Z' }, data)
      .length,
    1
  )
  assert.equal(
    executeSearch({ keywords: [], updatedBefore: '2026-08-01T00:00:00Z' }, data)
      .length,
    0
  )
})

test('local capture recognizes a newly named subject before a known platform', () => {
  const result = parseLocalCapture(
    '帮我记录一下，星河科技的阿里云账号是 ops@example.com，用于商城项目',
    fixtureVault()
  )
  assert.equal(result[0].subject, '星河科技')
  assert.equal(result[0].platform, '阿里云')
})
