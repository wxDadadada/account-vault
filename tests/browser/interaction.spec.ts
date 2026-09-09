import { expect, test, type Page } from '@playwright/test'
import { type VaultResponse } from '../../shared/protocol'
import { master } from '../fixtures'

let before: VaultResponse
async function unlock(page: Page) {
  await page.goto('/')
  await page.getByLabel('主密码', { exact: true }).fill(master)
  await page.getByRole('button', { name: '解锁账号库', exact: true }).click()
  await expect(page.getByRole('heading', { name: '我的账号库' })).toBeVisible()
}
async function requestExit(page: Page) {
  await page
    .getByRole('button', { name: '锁定账号库', exact: true })
    .filter({ visible: true })
    .click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
}
async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: '发送给 AI 助手的消息' }).fill(text)
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止回复' })).toHaveCount(0)
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

test('manual exit can be cancelled and only confirmation revokes the session and locks other pages', async ({
  page,
  context,
}, info) => {
  let logouts = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/logout')) logouts++
  })
  const second = await context.newPage()
  await unlock(second)
  await requestExit(page)
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toContainText('已保存的账号会保留')
  await expect(
    confirmation.getByRole('button', { name: '继续使用' })
  ).toBeFocused()
  expect(logouts).toBe(0)
  await confirmation.getByRole('button', { name: '继续使用' }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(
    second.getByRole('heading', { name: '我的账号库' })
  ).toBeVisible()
  expect((await page.request.get('/api/vault')).status()).toBe(200)
  await requestExit(page)
  await page.keyboard.press('Escape')
  await expect(confirmation).toHaveCount(0)
  expect(logouts).toBe(0)
  if (info.project.name === 'desktop')
    await page.locator('.profile-button').click()
  else await requestExit(page)
  await expect(confirmation).toHaveAttribute('data-state', 'open')
  await page.screenshot({
    path: test.info().outputPath('exit-confirmation.png'),
    animations: 'disabled',
  })
  await confirmation
    .getByRole('button', { name: '确认退出', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await expect(second.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  expect(logouts).toBe(1)
  expect((await page.request.get('/api/vault')).status()).toBe(401)
  await page.getByRole('button', { name: '体验示例空间', exact: true }).click()
  const exitDemo = page
    .getByRole('button', { name: /^退出体验/ })
    .filter({ visible: true })
  await exitDemo.click()
  await expect(confirmation).toContainText('本次示例中的修改会被清除')
  await confirmation
    .getByRole('button', { name: '继续使用', exact: true })
    .click()
  expect(logouts).toBe(1)
  await exitDemo.click()
  await confirmation
    .getByRole('button', { name: '确认退出体验', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
})

test('manual exit remains available during a pending write and the revoked write cannot save', async ({
  page,
}) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/vault', async (route) => {
    if (route.request().method() === 'PUT') await gate
    await route.continue()
  })
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/vault') && r.request().method() === 'PUT'
  )
  try {
    await page
      .getByRole('button', { name: '取消收藏 测试云平台', exact: true })
      .click()
    await requestExit(page)
    await expect(page.getByRole('alertdialog')).toContainText(
      '当前操作尚未结束'
    )
    await page.getByRole('button', { name: '确认退出', exact: true }).click()
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
    release()
    expect((await response).status()).toBe(401)
    await unlock(page)
    expect(
      (await (await page.request.get('/api/vault')).json()).payload
    ).toEqual(before.payload)
  } finally {
    release()
  }
})

test('untouched editors close immediately and changed account fields survive cancelling discard', async ({
  page,
}) => {
  const add = page
    .getByRole('button', { name: '添加账号', exact: true })
    .filter({ visible: true })
  await add.click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await add.click()
  await page.getByLabel('平台名称 *', { exact: true }).fill('未保存的平台')
  await page
    .getByLabel('账号 / 登录标识 *', { exact: true })
    .fill('unsaved-user')
  await page.getByLabel('密码', { exact: true }).fill('UNSAVED_SECRET')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('放弃未保存的修改')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue(
    'UNSAVED_SECRET'
  )
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(
    page.getByLabel('账号 / 登录标识 *', { exact: true })
  ).toHaveValue('unsaved-user')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await (await page.request.get('/api/vault')).json()).payload).toEqual(
    before.payload
  )
  await add.click()
  await expect(page.getByLabel('平台名称 *', { exact: true })).toHaveValue('')
})

test('subject and category editors confirm before discarding changes', async ({
  page,
}) => {
  await page
    .getByRole('link', { name: /^(主体与分类|主体)$/ })
    .filter({ visible: true })
    .click()
  for (const name of ['主体', '分类']) {
    if (name === '分类')
      await page.getByRole('button', { name: /^分类/ }).click()
    await page.getByRole('button', { name: `添加${name}`, exact: true }).click()
    await page.getByLabel(`${name}名称`, { exact: true }).fill(`未保存${name}`)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('button', { name: '继续编辑', exact: true }).click()
    await expect(page.getByLabel(`${name}名称`, { exact: true })).toHaveValue(
      `未保存${name}`
    )
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '放弃修改', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  expect((await (await page.request.get('/api/vault')).json()).payload).toEqual(
    before.payload
  )
})

test('chat keeps per-mode input and protects drafts on reset and close', async ({
  page,
}) => {
  await page.getByRole('button', { name: '开始记录', exact: true }).click()
  const input = page.getByRole('textbox', { name: '发送给 AI 助手的消息' })
  await input.fill('尚未发送的录入')
  await page.getByRole('button', { name: '查找账号', exact: true }).click()
  await expect(input).toHaveValue('')
  await input.fill('尚未发送的查询')
  await page.getByRole('button', { name: '记录账号', exact: true }).click()
  await expect(input).toHaveValue('尚未发送的录入')
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(input).toHaveValue('尚未发送的录入')
  await page.getByRole('button', { name: '新对话', exact: true }).click()
  await page.getByRole('button', { name: '清空并开始', exact: true }).click()
  await expect(input).toHaveValue('')
  await send(page, 'GitHub 账号是 staged-user，属于我个人')
  const expand = page.getByRole('button', { name: '展开草稿详情', exact: true })
  if (await expand.isVisible()) await expand.click()
  await page
    .getByLabel('密码（安全字段，可选）', { exact: true })
    .fill('STAGED_CHAT_SECRET')
  await page.getByRole('button', { name: '查找账号', exact: true }).click()
  await expect(input).toHaveValue('尚未发送的查询')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await expect(page.getByRole('alertdialog')).toContainText(
    '关闭助手并放弃草稿'
  )
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await page.getByRole('button', { name: '记录账号', exact: true }).click()
  await expect(
    page.getByLabel('密码（安全字段，可选）', { exact: true })
  ).toHaveValue('STAGED_CHAT_SECRET')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await page.getByRole('button', { name: '放弃并关闭', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await (await page.request.get('/api/vault')).json()).payload).toEqual(
    before.payload
  )
})

test('chat prevents omitting an unsent correction when saving and recognizes polite search requests', async ({
  page,
}) => {
  await page.getByRole('button', { name: '开始记录', exact: true }).click()
  await send(page, 'GitHub 账号是 pending-save，属于我个人')
  await page
    .getByRole('textbox', { name: '发送给 AI 助手的消息' })
    .fill('备注改为最终补充')
  await page.getByRole('button', { name: '核对并保存', exact: true }).click()
  await page
    .getByRole('button', { name: '确认保存 1 个账号', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText('还有未发送的补充')
  expect((await (await page.request.get('/api/vault')).json()).payload).toEqual(
    before.payload
  )
  await page.getByRole('button', { name: '返回对话', exact: true }).click()
  await expect(
    page.getByRole('textbox', { name: '发送给 AI 助手的消息' })
  ).toHaveValue('备注改为最终补充')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.getByRole('button', { name: '核对并保存', exact: true }).click()
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('最终补充')
  await page
    .getByRole('button', { name: '确认保存 1 个账号', exact: true })
    .click()
  await expect(page.getByRole('log')).toContainText('已保存 1 个账号')
  await send(page, '请帮我查一下测试云平台')
  await expect(
    page.getByRole('button', { name: '查找账号', exact: true })
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('region', { name: '对话查询结果' })
  ).toContainText('找到 1 个账号')
})

test('automatic locking bypasses an open discard confirmation and clears sensitive drafts', async ({
  page,
}) => {
  await page.clock.install({ time: new Date() })
  await unlock(page)
  await page
    .getByRole('button', { name: '添加账号', exact: true })
    .filter({ visible: true })
    .click()
  await page.getByLabel('密码', { exact: true }).fill('AUTO_LOCK_DRAFT_SECRET')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.clock.fastForward(75000)
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('exit confirmation fits narrow and landscape screens with dark theme and larger text', async ({
  page,
}, info) => {
  if (info.project.name !== 'mobile') return
  await page.setViewportSize({ width: 375, height: 667 })
  await requestExit(page)
  for (const layout of ['narrow', 'dark-landscape']) {
    if (layout === 'dark-landscape') {
      await page.evaluate(() => {
        document.documentElement.classList.add('dark')
        document.documentElement.style.fontSize = '20px'
      })
      await page.setViewportSize({ width: 844, height: 390 })
    }
    const size = page.viewportSize()!
    const dialog = page.getByRole('alertdialog')
    await expect
      .poll(async () => {
        const box = await dialog.boundingBox()
        return (
          !!box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= size.width + 1 &&
          box.y + box.height <= size.height + 1
        )
      })
      .toBe(true)
    const confirm = dialog.getByRole('button', {
      name: '确认退出',
      exact: true,
    })
    await confirm.scrollIntoViewIfNeeded()
    await expect(confirm).toBeInViewport()
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
    ).toBe(true)
    await page.screenshot({
      path: test.info().outputPath(`exit-${layout}.png`),
    })
  }
})
