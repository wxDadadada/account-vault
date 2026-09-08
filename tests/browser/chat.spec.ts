import { expect, test, type Page, type Locator } from '@playwright/test'
import { type ChatRequest } from '../../shared/ai-chat'
import { type VaultResponse } from '../../shared/protocol'
import { master } from '../fixtures'

let before: VaultResponse
async function unlock(page: Page) {
  await page.goto('/')
  await page.getByLabel('主密码', { exact: true }).fill(master)
  await page.getByRole('button', { name: '解锁账号库', exact: true }).click()
  await expect(page.getByRole('heading', { name: '我的账号库' })).toBeVisible()
}
test.beforeEach(async ({ page }) => {
  await unlock(page)
  before = await (await page.request.get('/api/vault')).json()
})
test.afterEach(async ({ page, baseURL }) => {
  let response = await page.request.get('/api/vault')
  if (response.status() === 401) {
    await unlock(page)
    response = await page.request.get('/api/vault')
  }
  const current = (await response.json()) as VaultResponse
  const restored = await page.request.put('/api/vault', {
    headers: { origin: baseURL!, 'x-keyfolio': '1' },
    data: { revision: current.revision, payload: before.payload },
  })
  expect(restored.status()).toBe(200)
})
async function openChat(page: Page, mode = 'capture') {
  await page
    .getByRole('button', {
      name: mode === 'capture' ? '开始记录' : '自然语言查找',
      exact: true,
    })
    .click()
  await expect(
    page.getByRole('heading', { name: '拾钥 AI 助手' })
  ).toBeVisible()
}
async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: '发送给 AI 助手的消息' }).fill(text)
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止回复' })).toHaveCount(0)
}
async function inViewport(locator: Locator, page: Page) {
  const size = page.viewportSize()!
  await expect
    .poll(async () => {
      const box = await locator.boundingBox()
      return (
        !!box &&
        box.x >= -1 &&
        box.y >= -1 &&
        box.x + box.width <= size.width + 1 &&
        box.y + box.height <= size.height + 1
      )
    })
    .toBe(true)
}
async function configureCloud(page: Page) {
  await page
    .getByRole('link', { name: '设置', exact: true })
    .filter({ visible: true })
    .click()
  await page
    .getByLabel('API Key', { exact: true })
    .fill('synthetic-chat-api-key')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(
    page.getByText('AI 配置已加密保存', { exact: true })
  ).toBeVisible()
  await page
    .getByRole('link', { name: /^账号库/ })
    .filter({ visible: true })
    .click()
  await expect(page.getByRole('heading', { name: '我的账号库' })).toBeVisible()
}

test('local chat asks missing fields, keeps corrections and secure password, then saves after confirmation', async ({
  page,
}) => {
  const writes: string[] = []
  page.on('request', (req) => {
    if (req.url().endsWith('/api/vault') && req.method() === 'PUT')
      writes.push(req.postData() ?? '')
  })
  await openChat(page)
  await send(page, '帮我记一个账号')
  await expect(page.getByRole('log')).toContainText('哪个平台')
  await send(page, 'GitHub')
  await expect(page.getByRole('log')).toContainText('登录标识是什么')
  await send(page, 'chat-user')
  await expect(page.getByRole('log')).toContainText('这个账号属于谁')
  await page.getByRole('button', { name: '星河科技', exact: true }).click()
  await page
    .getByLabel('密码（安全字段，可选）', { exact: true })
    .fill('CHAT_PRIVATE_PASSWORD!')
  await send(page, '备注改为生产环境')
  expect(writes).toHaveLength(0)
  await page.getByRole('button', { name: '核对并保存', exact: true }).click()
  await expect(page.getByLabel('账号 *', { exact: true })).toHaveValue(
    'chat-user'
  )
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('生产环境')
  await expect(
    page.getByLabel('密码（安全字段）', { exact: true })
  ).toHaveValue('CHAT_PRIVATE_PASSWORD!')
  await inViewport(
    page.getByRole('button', { name: '确认保存 1 个账号', exact: true }),
    page
  )
  await page.screenshot({ path: test.info().outputPath('chat-review.png') })
  await page.getByRole('button', { name: '返回对话', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('备注改为生产环境')
  await send(page, '确认保存')
  await expect(page.getByRole('log')).toContainText('已保存 1 个账号')
  expect(writes).toHaveLength(1)
  expect(writes[0]).not.toContain('CHAT_PRIVATE_PASSWORD!')
  await page.getByRole('button', { name: '查找账号', exact: true }).click()
  await send(page, '查找GitHub')
  await expect(
    page.getByRole('region', { name: '对话查询结果' })
  ).toContainText('chat-user')
  await page.getByRole('button', { name: /GitHub chat-user/ }).click()
  await expect(
    page.getByRole('heading', { name: 'GitHub', exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: '显示密码', exact: true }).click()
  await expect(
    page.getByText('CHAT_PRIVATE_PASSWORD!', { exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('查找GitHub')
})

test('search follows up on criteria, relaxes empty results, and preserves capture conversation', async ({
  page,
}) => {
  await openChat(page)
  await send(page, 'GitHub')
  await page.getByRole('button', { name: '查找账号', exact: true }).click()
  await send(page, '查找账号')
  await expect(page.getByRole('log')).toContainText('想查哪个平台')
  await send(page, '测试云平台')
  const results = page.getByRole('region', { name: '对话查询结果' })
  await expect(results).toContainText('找到 1 个账号')
  await send(page, '只看星河科技的')
  await expect(results).toContainText('找到 0 个账号')
  await page.getByRole('button', { name: '不限主体', exact: true }).click()
  await expect(results).toContainText('找到 1 个账号')
  await send(page, '只看使用中')
  await expect(results).toContainText('找到 1 个账号')
  await expect(results.getByRole('button').first()).toBeInViewport()
  await page.screenshot({ path: test.info().outputPath('chat-search.png') })
  await page.getByRole('button', { name: '记录账号', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('GitHub')
  await expect(
    page.getByRole('region', { name: '待保存的账号草稿' })
  ).toContainText('账号待补充')
})

test('cloud chat carries nonsecret context, handles failures and cancellation, and clears on lock', async ({
  page,
  context,
  baseURL,
}) => {
  await configureCloud(page)
  const requests: ChatRequest[] = []
  let fail = false
  let pause = false
  let release: (() => void) | undefined
  await page.route('**/api/ai/chat', async (route) => {
    const input = route.request().postDataJSON() as ChatRequest
    requests.push(structuredClone(input))
    if (pause)
      await new Promise<void>((resolve) => {
        release = resolve
      })
    if (fail) {
      await route
        .fulfill({ status: 422, json: { message: '测试回复失败' } })
        .catch(() => {})
      return
    }
    if (input.mode === 'search') {
      const plan = input.context.plan ?? { keywords: ['测试云平台'] }
      const content = input.turns[input.turns.length - 1].text
      if (content.includes('星河科技')) plan.subject = '星河科技'
      if (content === '不限主体') delete plan.subject
      await route.fulfill({ json: { mode: 'search', reply: '', plan } })
      return
    }
    const item = input.context.items[0] ?? {
      action: 'create',
      platform: 'GitHub',
    }
    const turn = input.turns[input.turns.length - 1]
    if (turn.field === 'username') item.username = turn.text
    if (turn.field === 'subject') item.subject = ''
    if (turn.field === 'details' && input.context.items.length)
      item.notes = '云端补充'
    await route
      .fulfill({
        json: { mode: 'capture', reply: '已整理这次补充。', items: [item] },
      })
      .catch(() => {})
  })
  await openChat(page)
  await send(page, 'GitHub')
  const input = page.getByRole('textbox', { name: '发送给 AI 助手的消息' })
  await input.fill('cloud-user')
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
  })
  expect(requests).toHaveLength(1)
  await send(page, 'cloud-user')
  await page.getByRole('button', { name: '暂不分配', exact: true }).click()
  await expect(
    page.getByLabel('密码（安全字段，可选）', { exact: true })
  ).toBeVisible()
  await page
    .getByLabel('密码（安全字段，可选）', { exact: true })
    .fill('NEVER_SEND_THIS_SECRET')
  await send(page, '备注改为云端补充')
  expect(requests).toHaveLength(4)
  expect(requests[3].turns).toHaveLength(4)
  expect(requests[3].context.items[0].username).toBe('cloud-user')
  expect(requests[3].context.items[0].draftId).toBeTruthy()
  for (const secret of [
    'NEVER_SEND_THIS_SECRET',
    'PRIVATE_PASSWORD_SENTINEL',
    'PRIVATE_NOTE_SENTINEL',
    '13800001234',
  ])
    expect(JSON.stringify(requests)).not.toContain(secret)
  await send(page, '密码是 should-not-send')
  expect(requests).toHaveLength(4)
  await expect(page.getByRole('alert')).toContainText('安全字段')
  fail = true
  await send(page, '备注改为重试内容')
  await expect(input).toHaveValue('备注改为重试内容')
  await expect(
    page.getByLabel('密码（安全字段，可选）', { exact: true })
  ).toHaveValue('NEVER_SEND_THIS_SECRET')
  fail = false
  pause = true
  await input.fill('备注改为暂停内容')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '停止回复', exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: '停止回复', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('已停止')
  release?.()
  await expect(input).toHaveValue('备注改为暂停内容')
  expect(requests).toHaveLength(6)
  pause = false
  await page.getByRole('button', { name: '查找账号', exact: true }).click()
  await send(page, '查找测试云平台')
  const results = page.getByRole('region', { name: '对话查询结果' })
  await expect(results).toContainText('找到 1 个账号')
  await send(page, '只看星河科技')
  await expect(results).toContainText('找到 0 个账号')
  await send(page, '不限主体')
  await expect(results).toContainText('找到 1 个账号')
  expect(requests[8].context.plan?.subject).toBe('星河科技')
  await page.getByRole('button', { name: '记录账号', exact: true }).click()
  await expect(
    page.getByLabel('密码（安全字段，可选）', { exact: true })
  ).toHaveValue('NEVER_SEND_THIS_SECRET')
  const second = await context.newPage()
  await unlock(second)
  await second
    .getByRole('button', { name: '锁定账号库', exact: true })
    .filter({ visible: true })
    .click()
  await second.getByRole('button', { name: '确认退出', exact: true }).click()
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await unlock(page)
  await openChat(page)
  await expect(page.getByRole('log')).not.toContainText('cloud-user')
  expect(baseURL).toContain('127.0.0.1')
})

test('chat controls remain usable in narrow, landscape, dark and enlarged text layouts', async ({
  page,
}, info) => {
  if (info.project.name !== 'mobile') return
  await page.setViewportSize({ width: 375, height: 667 })
  await openChat(page)
  await send(page, 'GitHub')
  for (const layout of ['narrow', 'dark-large', 'landscape']) {
    if (layout === 'dark-large') {
      await page.evaluate(() => {
        document.documentElement.classList.add('dark')
        document.documentElement.style.fontSize = '20px'
      })
    }
    if (layout === 'landscape') {
      await page.evaluate(() => {
        document.documentElement.style.fontSize = ''
      })
      await page.setViewportSize({ width: 844, height: 390 })
    }
    const dialog = page.getByRole('dialog')
    await inViewport(dialog, page)
    await inViewport(
      page.getByRole('textbox', { name: '发送给 AI 助手的消息' }),
      page
    )
    await inViewport(
      page.getByRole('button', { name: '发送消息', exact: true }),
      page
    )
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
    ).toBe(true)
    await page.screenshot({
      path: test.info().outputPath(`chat-${layout}.png`),
    })
  }
})
