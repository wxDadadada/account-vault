import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KDF_ITERATIONS } from '../shared/protocol'
import { draftFor, saveDrafts } from '../src/vault/lib/ai-conversation'
import {
  accountIssues,
  bulkDelete,
  bulkUpdate,
  daysUntil,
  defaultFilter,
  filterAccounts,
  purgeDeleted,
  restoreDeleted,
  trashEntries,
} from '../src/vault/lib/collection'
import {
  createCredentials,
  decryptVault,
  encryptVault,
  makeBackup,
  readBackup,
} from '../src/vault/lib/crypto'
import {
  deleteAccount,
  mergeBackup,
  saveAccount,
} from '../src/vault/lib/domain'
import { emptyVault } from '../src/vault/lib/model'
import {
  applyImport,
  parseTable,
  previewImport,
  suggestMapping,
} from '../src/vault/lib/table-import'
import { parseTOTP, validTOTP } from '../src/vault/lib/totp'
import { validateVault } from '../src/vault/lib/validation'
import { fixtureAccount, fixtureVault, master } from './fixtures'

const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
test('new secret fields survive encryption, backups, merges and AI updates without entering chat items', async () => {
  const data = fixtureVault()
  Object.assign(data.accounts[0], {
    alias: '生产账号',
    expiresOn: '2028-12-31',
    reminderDays: 14,
    totp: seed,
    customFields: [
      {
        id: 'token',
        label: 'API Token',
        value: 'PRIVATE_EXTRA_TOKEN_SENTINEL',
        secret: true,
      },
    ],
  })
  data.savedViews = [
    { id: 'view', name: '待办', filter: { ...defaultFilter(), issue: 'due' } },
  ]
  const credentials = await createCredentials('owner', master)
  const encrypted = await encryptVault(credentials.key, data)
  const wire = JSON.stringify(encrypted)
  assert.ok(!wire.includes(seed))
  assert.ok(!wire.includes('PRIVATE_EXTRA_TOKEN_SENTINEL'))
  assert.deepEqual(await decryptVault(credentials.key, encrypted), data)
  const backup = await makeBackup(data, credentials.key, {
    username: 'owner',
    kdfSalt: credentials.credentials.kdfSalt,
    wrappedKey: credentials.credentials.wrappedKey,
    recoveryWrappedKey: credentials.credentials.recoveryWrappedKey,
    kdfIterations: KDF_ITERATIONS,
  })
  const restored = await readBackup(JSON.stringify(backup), master, false)
  assert.deepEqual(
    restored.accounts[0].customFields,
    data.accounts[0].customFields
  )
  const merged = mergeBackup(emptyVault(), data).data
  assert.equal(merged.accounts[0].totp, seed)
  const draft = draftFor(
    {
      action: 'update',
      platform: data.accounts[0].platform,
      username: data.accounts[0].username,
      notes: '新的备注',
    },
    data,
    'all'
  )
  assert.ok(!JSON.stringify(draft.item).includes(seed))
  assert.ok(
    !JSON.stringify(draft.item).includes('PRIVATE_EXTRA_TOKEN_SENTINEL')
  )
  draft.subjectConfirmed = true
  const updated = saveDrafts(data, [draft], 'ai')
  assert.equal(updated.accounts[0].totp, seed)
  assert.deepEqual(
    updated.accounts[0].customFields,
    data.accounts[0].customFields
  )
})
test('legacy vaults stay readable and malformed new dates, secrets and custom fields are rejected', () => {
  const data = fixtureVault()
  assert.deepEqual(validateVault(data), data)
  for (const extra of [
    { expiresOn: '2026-02-30' },
    { expiresOn: '12/31/2026' },
    { totp: 'not-a-valid-secret' },
    { reminderDays: -1 },
    { customFields: [{ id: 'x', label: '', value: 'secret', secret: true }] },
  ])
    assert.throws(() =>
      validateVault({ ...data, accounts: [{ ...data.accounts[0], ...extra }] })
    )
})
test('bulk operations are atomic and refuse stale edits and duplicate destinations', () => {
  let data = fixtureVault()
  data.accounts.push({
    ...fixtureAccount(data.subjects[0].id),
    username: 'second',
  })
  const expected = structuredClone(data.accounts)
  const changed = bulkUpdate(data, expected, {
    status: 'pending',
    favorite: false,
    addTags: ['团队'],
    removeTags: ['生产'],
  })
  assert.ok(
    changed.accounts.every(
      (a) =>
        a.status === 'pending' &&
        !a.favorite &&
        a.tags.includes('团队') &&
        !a.tags.includes('生产')
    )
  )
  assert.equal(changed.changes.length, 2)
  assert.ok(data.accounts.every((a) => a.status === 'active'))
  data = saveAccount(data, { ...data.accounts[1], notes: 'concurrent edit' })
  const before = structuredClone(data)
  assert.throws(
    () => bulkUpdate(data, expected, { category: '其他' }),
    /已发生变化/
  )
  assert.throws(() => bulkDelete(data, expected), /已发生变化/)
  assert.deepEqual(data, before)
  const duplicate = fixtureVault()
  duplicate.subjects.push({
    id: 'other',
    name: '其他主体',
    type: 'company',
    aliases: [],
    color: 'blue',
  })
  duplicate.accounts.push({
    ...duplicate.accounts[0],
    id: 'second',
    subjectId: 'other',
  })
  const original = structuredClone(duplicate)
  assert.throws(
    () =>
      bulkUpdate(duplicate, duplicate.accounts, {
        subjectId: original.subjects[0].id,
      }),
    /已经有相同/
  )
  assert.deepEqual(duplicate, original)
})
test('recycle bin reads historical deletions, restores atomically and purges only selected deleted identities', () => {
  let data = fixtureVault()
  const live = { ...fixtureAccount(data.subjects[0].id), username: 'kept' }
  data = saveAccount(data, live)
  const removed = data.accounts.find((a) => a.id !== live.id)!
  data = deleteAccount(data, removed)
  assert.equal(trashEntries(validateVault(data))[0].account.id, removed.id)
  const restored = restoreDeleted(data, [removed])
  assert.equal(trashEntries(restored).length, 0)
  assert.equal(restored.changes[0].action, 'restore')
  assert.throws(() => purgeDeleted(restored, [removed]), /已发生变化/)
  const purged = purgeDeleted(data, [removed])
  assert.equal(trashEntries(purged).length, 0)
  assert.ok(!purged.changes.some((c) => c.accountId === removed.id))
  assert.equal(purged.accounts[0].id, live.id)
  assert.ok(purged.changes.some((c) => c.accountId === live.id))
})
test('filters combine tags, owner, status, aliases and issues without searching secret custom fields', () => {
  const data = fixtureVault()
  data.accounts[0] = {
    ...data.accounts[0],
    alias: '生产主号',
    tags: ['生产', '商城'],
    customFields: [
      {
        id: 'secret',
        label: 'Token',
        value: 'HIDDEN_TOKEN_SENTINEL',
        secret: true,
      },
      { id: 'note', label: 'Region', value: 'Shanghai', secret: false },
    ],
  }
  assert.equal(
    filterAccounts(data, {
      ...defaultFilter(),
      query: '生产主号 Shanghai',
      tags: ['生产', '商城'],
    }).length,
    1
  )
  assert.equal(
    filterAccounts(data, { ...defaultFilter(), query: 'HIDDEN_TOKEN_SENTINEL' })
      .length,
    0
  )
  assert.equal(
    filterAccounts(data, { ...defaultFilter(), tags: ['不存在'] }).length,
    0
  )
  assert.equal(
    filterAccounts(data, { ...defaultFilter(), subject: '' }).length,
    0
  )
  assert.equal(
    filterAccounts(data, { ...defaultFilter(), status: 'inactive' }).length,
    0
  )
})
test('local checks explain weak or reused passwords, respect passwordless login and calendar expiry', () => {
  const a = fixtureAccount()
  a.password = 'password1'
  a.expiresOn = '2026-09-08'
  a.reminderDays = 3
  const other = {
    ...a,
    id: 'other',
    username: 'other',
    loginMethod: '手机验证码',
    password: '',
    subjectId: 'x',
  }
  const now = new Date(2026, 8, 8, 23, 59)
  const checks = accountIssues([a, { ...a, id: 'duplicate' }, other], now)
  assert.ok(checks.get(a.id)!.some((i) => i.type === 'weak'))
  assert.ok(checks.get(a.id)!.some((i) => i.type === 'reused'))
  assert.ok(
    checks
      .get(a.id)!
      .some((i) => i.type === 'due' && i.reason.includes('今天到期'))
  )
  assert.ok(
    !checks.get('other')!.some((i) => i.reason.includes('待补充：密码'))
  )
  assert.equal(daysUntil('2026-09-09', now), 1)
  assert.deepEqual(
    accountIssues([{ ...a, status: 'inactive' }], now).get(a.id),
    []
  )
})
test('TOTP accepts supported authenticator URIs and matches the RFC 6238 SHA1 vector', () => {
  const otp = parseTOTP(
    `otpauth://totp/Test:owner?secret=${seed}&issuer=Test&digits=8&period=30&algorithm=SHA1`
  )
  assert.equal(otp.generate({ timestamp: 59000 }), '94287082')
  assert.equal(parseTOTP(seed).generate({ timestamp: 59000 }), '287082')
  assert.equal(
    validTOTP('otpauth://hotp/Test?secret=' + seed + '&counter=1'),
    false
  )
  assert.equal(
    validTOTP('otpauth://totp/Test?secret=' + seed + '&period=0'),
    false
  )
  assert.equal(validTOTP('AAAA'), false)
})
test('CSV and pasted spreadsheet parsing supports BOM, escaped quotes and embedded newlines', () => {
  const table = parseTable(
    '\uFEFF平台,账号,备注\r\nGitHub,user,"一行,文本\n第二行"\r\nFigma,design,"他说""你好"""\r\n'
  )
  assert.equal(table.rows[0][2], '一行,文本\n第二行')
  assert.equal(table.rows[1][2], '他说"你好"')
  assert.equal(
    parseTable('平台\t账号\t备注\nGitHub\tuser\t逗号,在内容中').rows.length,
    1
  )
  for (const text of [
    '平台,账号\n"Github,user',
    '平台,账号\nGitHub,user,extra',
    '平台,账号\nGit"hub,user',
  ])
    assert.throws(() => parseTable(text))
})
test('table import previews row errors, preserves unmapped fields and adds one subject for multiple rows', () => {
  const data = fixtureVault()
  const table = parseTable(
    '平台,账号,所属主体,密码\nGitHub,user,新公司,secret1\nFigma,design,新公司,secret2'
  )
  const preview = previewImport(
    data,
    table.rows,
    suggestMapping(table.headers),
    'skip',
    ''
  )
  assert.ok(preview.every((r) => r.action === 'add'))
  const imported = applyImport(data, preview)
  assert.equal(imported.subjects.filter((s) => s.name === '新公司').length, 1)
  assert.equal(imported.accounts.length, 3)
  assert.doesNotThrow(() => validateVault(imported))
  const duplicate = previewImport(
    imported,
    table.rows,
    suggestMapping(table.headers),
    'skip',
    ''
  )
  assert.ok(duplicate.every((r) => r.action === 'skip'))
  const source = data.accounts[0]
  source.customFields = [
    { id: 'token', label: 'token', value: 'KEEP_SECRET', secret: true },
  ]
  source.totp = seed
  const changed = previewImport(
    data,
    [[source.platform, source.username, source.url, '更新后的备注']],
    { platform: 0, username: 1, url: 2, notes: 3 },
    'update',
    source.subjectId
  )
  const result = applyImport(data, changed)
  assert.equal(result.accounts[0].password, source.password)
  assert.equal(result.accounts[0].totp, seed)
  assert.equal(result.accounts[0].customFields?.[0].value, 'KEEP_SECRET')
  assert.equal(result.accounts[0].notes, '更新后的备注')
  const broken = previewImport(
    data,
    [['x', 'a', 'javascript:alert(1)']],
    { platform: 0, username: 1, url: 2 },
    'skip',
    ''
  )
  assert.equal(broken[0].action, 'error')
  assert.throws(() => applyImport(data, broken), /修正/)
  const sameRows = previewImport(
    data,
    [
      ['x', 'a'],
      ['x', 'a'],
    ],
    { platform: 0, username: 1 },
    'skip',
    ''
  )
  assert.equal(sameRows[1].action, 'error')
})
