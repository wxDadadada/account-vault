import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertChatSafe,
  chatRequestSchema,
  chatResponseSchema,
} from '../shared/ai-chat'
import {
  captureQuestion,
  draftFor,
  inferChatMode,
  localChat,
  materializeDrafts,
  patchDraft,
  refineLocalSearch,
  saveDrafts,
  searchFeedback,
  type Draft,
} from '../src/vault/lib/ai-conversation'
import { executeSearch } from '../src/vault/lib/ai-local'
import { type VaultData } from '../src/vault/lib/model'
import { fixtureAccount, fixtureVault } from './fixtures'

function answer(text: string, drafts: Draft[], data: VaultData) {
  const question = captureQuestion(drafts, data)
  const result = localChat(
    'capture',
    {
      text,
      field: question?.field ?? 'details',
      itemIndex: question?.itemIndex,
    },
    { items: drafts.map((d) => d.item), plan: null },
    data
  )
  assert.equal(result.mode, 'capture')
  if (result.mode !== 'capture') throw new Error('unexpected mode')
  return materializeDrafts(result.items, data, 'all', drafts)
}

test('missing information is completed across turns without creating or saving extra records', () => {
  const data = fixtureVault()
  let drafts = answer('帮我记一个账号', [], data)
  assert.equal(captureQuestion(drafts, data)?.field, 'platform')
  assert.throws(() => saveDrafts(data, drafts, 'manual'), /哪个平台/)
  drafts = answer('GitHub', drafts, data)
  assert.equal(captureQuestion(drafts, data)?.field, 'username')
  drafts = answer('a', drafts, data)
  assert.equal(captureQuestion(drafts, data)?.field, 'subject')
  drafts = answer('新团队', drafts, data)
  assert.equal(captureQuestion(drafts, data), null)
  drafts[0] = patchDraft(drafts[0], { password: 'LOCAL_ONLY_SECRET' }, data)
  drafts = answer('备注改为生产环境', drafts, data)
  drafts = answer('用户名改成 new-user', drafts, data)
  drafts = answer('平台改成自定义平台', drafts, data)
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0].account.platform, '自定义平台')
  assert.equal(drafts[0].account.username, 'new-user')
  assert.equal(drafts[0].account.notes, '生产环境')
  assert.equal(drafts[0].account.password, 'LOCAL_ONLY_SECRET')
  assert.ok(
    !JSON.stringify(drafts.map((d) => d.item)).includes('LOCAL_ONLY_SECRET')
  )
  assert.equal(data.accounts.length, 1)
  const saved = saveDrafts(data, drafts, 'manual')
  assert.equal(saved.accounts.length, 2)
  assert.equal(saved.accounts[0].password, 'LOCAL_ONLY_SECRET')
  assert.equal(
    saved.subjects.find((s) => s.id === saved.accounts[0].subjectId)?.name,
    '新团队'
  )
  assert.equal(saved.changes[0].action, 'create')
  assert.equal(data.accounts.length, 1, 'commit input remains immutable')
})

test('stable draft identities retain local fields through reordering and additional accounts', () => {
  const data = fixtureVault()
  let drafts = answer('GitHub 账号是 one；阿里云 账号是 two', [], data)
  drafts[0] = patchDraft(drafts[0], { password: 'FIRST_SECRET' }, data)
  drafts[1] = patchDraft(drafts[1], { password: 'SECOND_SECRET' }, data)
  const added = materializeDrafts(
    [
      drafts[1].item,
      drafts[0].item,
      { action: 'create', platform: 'Notion', username: 'three' },
    ],
    data,
    'all',
    drafts
  )
  assert.deepEqual(
    added.map((d) => d.account.password),
    ['SECOND_SECRET', 'FIRST_SECRET', '']
  )
  assert.throws(
    () =>
      materializeDrafts(
        [{ action: 'create', platform: 'GitHub' }],
        data,
        'all',
        drafts
      ),
    /草稿标识/
  )
  assert.throws(
    () =>
      materializeDrafts([drafts[0].item, drafts[0].item], data, 'all', drafts),
    /重复引用/
  )
  drafts = answer('第2个 账号改为 renamed', drafts, data)
  assert.deepEqual(
    drafts.map((d) => d.account.username),
    ['one', 'renamed']
  )
  drafts = answer('另外添加 Notion 账号是 three', drafts, data)
  assert.equal(drafts.length, 3)
})

test('updating an ambiguous record asks for a target and preserves its existing confidential fields', () => {
  const data = fixtureVault()
  data.accounts.push({
    ...fixtureAccount(data.subjects[0].id),
    username: 'second',
  })
  let drafts = answer('更新测试云平台，邮箱改为 next@example.invalid', [], data)
  const question = captureQuestion(drafts, data)
  assert.equal(question?.field, 'target')
  assert.equal(question?.targets?.length, 2)
  assert.equal(drafts[0].item.username, undefined)
  drafts[0] = draftFor(drafts[0].item, data, 'all', data.accounts[1], drafts[0])
  drafts = answer('备注改为客服用途', drafts, data)
  assert.equal(captureQuestion(drafts, data), null)
  assert.equal(drafts[0].account.username, 'second')
  assert.equal(drafts[0].account.email, 'next@example.invalid')
  assert.equal(drafts[0].account.password, data.accounts[1].password)
  assert.ok(!JSON.stringify(drafts[0].item).includes(data.accounts[1].password))
  assert.ok(!JSON.stringify(drafts[0].item).includes(data.accounts[1].phone))
  const saved = saveDrafts(data, drafts, 'ai')
  assert.equal(saved.accounts.length, 2)
  assert.deepEqual(saved.accounts[0], data.accounts[0])
  assert.equal(saved.changes[0].action, 'update')
  assert.deepEqual(saved.changes[0].fields.sort(), ['email', 'notes'])
  data.accounts[1] = { ...data.accounts[1], notes: 'changed elsewhere' }
  assert.throws(() => saveDrafts(data, drafts, 'ai'), /发生变化/)
})

test('a failed later draft leaves the entire batch and subjects unchanged', () => {
  const data = fixtureVault()
  const drafts = materializeDrafts(
    [
      {
        action: 'create',
        platform: 'GitHub',
        username: 'new',
        subject: '新主体',
      },
      {
        action: 'create',
        platform: 'Notion',
        username: 'broken',
        subject: '',
        url: 'not-a-url',
      },
    ],
    data,
    'all'
  )
  const before = structuredClone(data)
  assert.throws(() => saveDrafts(data, drafts, 'manual'), /登录地址/)
  assert.deepEqual(data, before)
})

test('query followups retain prior filters, narrow results, and explicitly relax each filter', () => {
  const data = fixtureVault()
  for (const text of ['请帮我查询账号', '我想查一下账号', '麻烦你列出账号']) {
    assert.equal(inferChatMode(text, 'capture'), 'search')
    assert.deepEqual(refineLocalSearch(text, null, data), { keywords: [] })
  }
  assert.equal(inferChatMode('请帮我记录账号', 'search'), 'capture')
  assert.equal(inferChatMode('备注改为生产环境', 'capture'), 'capture')
  data.accounts[0].platform = '阿里云'
  data.subjects.push({
    id: 'company',
    name: '星河科技',
    aliases: ['星河'],
    type: 'company',
    color: 'blue',
  })
  data.accounts.push({
    ...fixtureAccount('company'),
    platform: '阿里云',
    username: 'company-user',
    favorite: false,
  })
  let plan = refineLocalSearch('查找阿里云', null, data)
  assert.equal(executeSearch(plan, data).length, 2)
  plan = refineLocalSearch('只看星河科技的', plan, data)
  assert.deepEqual(plan.keywords, ['阿里云'])
  assert.equal(executeSearch(plan, data).length, 1)
  plan = refineLocalSearch('只看使用中', plan, data)
  assert.deepEqual(plan.keywords, ['阿里云'])
  assert.equal(plan.status, 'active')
  assert.equal(executeSearch(plan, data).length, 1)
  plan = refineLocalSearch('只看收藏', plan, data)
  assert.equal(executeSearch(plan, data).length, 0)
  assert.ok(searchFeedback(plan, data, '只看收藏').choices.includes('不限收藏'))
  plan = refineLocalSearch('不限收藏', plan, data)
  assert.equal(executeSearch(plan, data).length, 1)
  plan = refineLocalSearch('最近7天修改过密码', plan, data)
  assert.equal(plan.changedField, 'password')
  assert.ok(plan.updatedAfter)
  plan = refineLocalSearch(
    '不限时间，不限主体，不限状态，不限变更字段',
    plan,
    data
  )
  assert.deepEqual(plan, { keywords: ['阿里云'] })
  plan = refineLocalSearch('只看未收藏', plan, data)
  assert.equal(plan.favorite, false)
  assert.equal(executeSearch(plan, data).length, 1)
  plan = refineLocalSearch('不限收藏，改查测试新平台', plan, data)
  assert.deepEqual(plan, { keywords: ['测试新平台'] })
  assert.deepEqual(refineLocalSearch('查看全部账号', plan, data), {
    keywords: [],
  })
  assert.equal(searchFeedback({ keywords: [] }, data, '查找账号').asking, true)
})

test('chat protocol bounds context and excludes secrets or executable model output', () => {
  const input = {
    mode: 'capture',
    turns: [{ text: 'a', field: 'username' }],
    context: { items: [], plan: null },
    categories: ['其他'],
    config: {
      baseUrl: 'https://api.deepseek.com',
      model: 'model',
      apiKey: 'test-key',
    },
  }
  assert.ok(chatRequestSchema.safeParse(input).success)
  assert.equal(
    chatRequestSchema.safeParse({
      ...input,
      turns: Array.from({ length: 33 }, () => ({ text: 'a' })),
    }).success,
    false
  )
  assert.equal(
    chatRequestSchema.safeParse({
      ...input,
      turns: Array.from({ length: 5 }, () => ({ text: 'a'.repeat(6000) })),
    }).success,
    false
  )
  assert.throws(
    () => assertChatSafe({ turns: [{ text: '密码是 private' }] }),
    /安全字段/
  )
  assert.throws(
    () => assertChatSafe({ items: [{ notes: 'API Key: secret' }] }),
    /安全字段/
  )
  for (const extra of [
    { password: 'secret' },
    { action: 'delete' },
    { execute: 'save' },
  ])
    assert.equal(
      chatResponseSchema.safeParse({
        mode: 'capture',
        reply: '',
        items: [{ platform: 'GitHub', ...extra }],
      }).success,
      false
    )
})
