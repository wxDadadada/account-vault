import { expect, test, type Locator, type Page } from '@playwright/test'
import { totp } from '../../server/security'
import {
  createCredentials,
  makeBackup,
  rewrapWithMaster,
} from '../../src/vault/lib/crypto'
import { emptyVault } from '../../src/vault/lib/model'
import { master, nextMaster } from '../fixtures'

async function unlock(page: Page, password = master) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await page.getByLabel('用户名', { exact: true }).fill('owner')
  await page.getByLabel('主密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '解锁账号库', exact: true }).click()
  await expect(page.getByRole('heading', { name: '我的账号库' })).toBeVisible()
}
async function lock(page: Page) {
  await page
    .getByRole('button', { name: '锁定账号库', exact: true })
    .filter({ visible: true })
    .click()
  await page.getByRole('button', { name: '确认退出', exact: true }).click()
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
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
async function settings(page: Page) {
  await page
    .getByRole('link', { name: '设置', exact: true })
    .filter({ visible: true })
    .click()
  await expect(page.getByRole('heading', { name: '登录与安全' })).toBeVisible()
}

test('detail and editor content, close controls and save actions stay in the viewport', async ({
  page,
}) => {
  await unlock(page)
  await page.locator('.account-card-main').first().click()
  const detail = page.getByRole('dialog')
  await inViewport(detail, page)
  await inViewport(detail.getByRole('heading', { name: '测试云平台' }), page)
  await inViewport(
    detail.getByRole('button', { name: 'Close', exact: true }),
    page
  )
  await detail.getByRole('button', { name: '显示密码', exact: true }).click()
  await expect(
    detail.getByText('PRIVATE_PASSWORD_SENTINEL_!9', { exact: true })
  ).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('detail.png') })
  await detail.getByRole('button', { name: 'Close', exact: true }).click()
  await page
    .getByRole('button', { name: '添加账号', exact: true })
    .filter({ visible: true })
    .click()
  const editor = page.getByRole('dialog')
  await inViewport(editor, page)
  await editor
    .getByRole('button', { name: '保存账号', exact: true })
    .scrollIntoViewIfNeeded()
  await inViewport(
    editor.getByRole('button', { name: '保存账号', exact: true }),
    page
  )
  await page.screenshot({ path: test.info().outputPath('editor.png') })
  await editor.getByRole('button', { name: 'Close', exact: true }).click()
})

test('locking one unlocked page removes passwords and dialogs from both pages', async ({
  page,
  context,
}) => {
  await unlock(page)
  const second = await context.newPage()
  await unlock(second)
  await second.locator('.account-card-main').first().click()
  await second.getByRole('button', { name: '显示密码', exact: true }).click()
  await expect(
    second.getByText('PRIVATE_PASSWORD_SENTINEL_!9', { exact: true })
  ).toBeVisible()
  await lock(page)
  await expect(second.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await expect(second.getByRole('dialog')).toHaveCount(0)
  await expect(
    second.getByText('PRIVATE_PASSWORD_SENTINEL_!9', { exact: true })
  ).toHaveCount(0)
})

test('a frozen page resumes locked even when BroadcastChannel is unavailable', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'BroadcastChannel', { value: undefined })
  })
  await unlock(page)
  const second = await context.newPage()
  await unlock(second)
  const cdp = await context.newCDPSession(second)
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' })
  await lock(page)
  await cdp.send('Page.setWebLifecycleState', { state: 'active' })
  await second.bringToFront()
  await expect(second.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await cdp.detach()
})

test('lock during password derivation prevents a late login request', async ({
  page,
  context,
}) => {
  await unlock(page)
  const second = await context.newPage()
  await second.addInitScript(() => {
    const original = SubtleCrypto.prototype.deriveBits
    const state = window as unknown as {
      deriving: boolean
      releaseDerivation: () => void
      derived: boolean
    }
    const barrier = new Promise<void>((resolve) => {
      state.releaseDerivation = resolve
    })
    SubtleCrypto.prototype.deriveBits = async function (
      ...args: Parameters<SubtleCrypto['deriveBits']>
    ) {
      state.deriving = true
      await barrier
      const result = await original.apply(this, args)
      state.derived = true
      return result
    }
  })
  let logins = 0
  second.on('request', (request) => {
    if (request.url().endsWith('/api/auth/login')) logins++
  })
  await second.goto('/')
  await second.getByLabel('主密码', { exact: true }).fill(master)
  await second.getByRole('button', { name: '解锁账号库', exact: true }).click()
  await expect
    .poll(() =>
      second.evaluate(
        () => (window as unknown as { deriving: boolean }).deriving
      )
    )
    .toBe(true)
  await lock(page)
  await second.evaluate(() =>
    (window as unknown as { releaseDerivation: () => void }).releaseDerivation()
  )
  await expect
    .poll(() =>
      second.evaluate(() => (window as unknown as { derived: boolean }).derived)
    )
    .toBe(true)
  await expect(second.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  expect(logins).toBe(0)
})

test('active use in one page keeps other pages open, then shared inactivity locks both', async ({
  page,
  context,
}) => {
  const time = new Date()
  await page.clock.install({ time })
  await unlock(page)
  const second = await context.newPage()
  await unlock(second)
  await page.clock.fastForward(55000)
  await page.getByPlaceholder('搜索平台、账号、标签…').click()
  await page.getByPlaceholder('搜索平台、账号、标签…').fill('测试')
  await page.clock.fastForward(30000)
  await expect(page.getByRole('heading', { name: '我的账号库' })).toBeVisible()
  await expect(
    second.getByRole('heading', { name: '我的账号库' })
  ).toBeVisible()
  await page.clock.fastForward(70000)
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await expect(second.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
})

for (const delayedExpiry of [false, true]) {
  test(`credential rotation preserves the initiating session (delayed expiry: ${delayedExpiry})`, async ({
    page,
    context,
  }) => {
    await unlock(page)
    const second = await context.newPage()
    if (delayedExpiry)
      await second.addInitScript(() => {
        const state = window as unknown as { holdLockNotifications: boolean }
        window.addEventListener(
          'storage',
          (event) => {
            if (state.holdLockNotifications) event.stopImmediatePropagation()
          },
          true
        )
        const original = BroadcastChannel.prototype.addEventListener
        BroadcastChannel.prototype.addEventListener = function (
          type: string,
          listener: EventListenerOrEventListenerObject | null,
          options?: boolean | AddEventListenerOptions
        ) {
          original.call(
            this,
            type,
            (event: Event) => {
              if (
                state.holdLockNotifications &&
                (event as MessageEvent).data?.type === 'lock'
              )
                return
              if (typeof listener === 'function') listener.call(this, event)
              else listener?.handleEvent(event)
            },
            options
          )
        }
      })
    await unlock(second)
    if (delayedExpiry)
      await second.evaluate(() => {
        ;(
          window as unknown as { holdLockNotifications: boolean }
        ).holdLockNotifications = true
      })
    await settings(page)
    await page.getByRole('button', { name: '修改', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('当前主密码', { exact: true }).fill(master)
    await dialog.getByLabel('新主密码', { exact: true }).fill(nextMaster)
    await dialog
      .getByLabel('再次输入新主密码', { exact: true })
      .fill(nextMaster)
    const rotatedResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/auth/credentials')
    )
    await dialog
      .getByRole('button', { name: '更新主密码', exact: true })
      .click()
    const response = await rotatedResponse
    expect(response.status()).toBe(200)
    const rotatedProfile = (await response.json()).profile
    try {
      await expect(
        page.getByRole('dialog', { name: '保存你的恢复密钥' })
      ).toBeVisible()
      if (delayedExpiry)
        // A response from the old session arrives before queued lock notifications.
        await second.evaluate(() =>
          window.dispatchEvent(new Event('keyfolio:session-expired'))
        )
      await expect(
        second.getByRole('heading', { name: '欢迎回来' })
      ).toBeVisible()
      await page
        .getByRole('checkbox', { name: '我已将恢复密钥保存在安全的位置' })
        .check()
      await page
        .getByRole('button', { name: '进入账号空间', exact: true })
        .click()
      await expect(
        page.getByRole('heading', { name: '登录与安全' })
      ).toBeVisible()
      const vault = await context.request.get('/api/vault')
      expect(vault.status()).toBe(200)
    } finally {
      const restored = await rewrapWithMaster(
        nextMaster,
        master,
        rotatedProfile
      )
      const reset = await context.request.post('/api/auth/credentials', {
        headers: { 'x-keyfolio': '1', origin: new URL(page.url()).origin },
        data: {
          currentProof: restored.currentProof,
          credentials: restored.credentials,
        },
      })
      expect(reset.status()).toBe(200)
    }
  })
}

test('a failed persistent lock write still removes passwords through BroadcastChannel', async ({
  page,
  context,
}) => {
  await unlock(page)
  const second = await context.newPage()
  await unlock(second)
  await second.locator('.account-card-main').first().click()
  await second.getByRole('button', { name: '显示密码', exact: true }).click()
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'keyfolio.lock-version')
        throw new DOMException('Storage is full', 'QuotaExceededError')
      original.call(this, key, value)
    }
  })
  await lock(page)
  await expect(second.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await expect(second.getByRole('dialog')).toHaveCount(0)
  await expect(
    second.getByText('PRIVATE_PASSWORD_SENTINEL_!9', { exact: true })
  ).toHaveCount(0)
})

test('a delayed successful TOTP response cannot log out a freshly unlocked page', async ({
  page,
  context,
}) => {
  const initialResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/login')
  )
  await unlock(page)
  const profile = (await (await initialResponse).json()).profile
  const second = await context.newPage()
  await unlock(second)
  await settings(second)
  await second.getByRole('button', { name: '开启', exact: true }).click()
  const dialog = second.getByRole('dialog')
  await dialog.getByLabel('主密码', { exact: true }).fill(master)
  const startResponse = second.waitForResponse((response) =>
    response.url().endsWith('/api/security/totp/start')
  )
  await dialog.getByRole('button', { name: '继续', exact: true }).click()
  const generator = totp((await (await startResponse).json()).secret, 'owner')
  await dialog
    .getByLabel('6 位验证码', { exact: true })
    .fill(generator.generate())
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let enabled!: () => void
  const committed = new Promise<void>((resolve) => {
    enabled = resolve
  })
  await second.route('**/api/security/totp/enable', async (route) => {
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    enabled()
    await gate
    await route.fulfill({ response })
  })
  await dialog.getByRole('button', { name: '验证并开启', exact: true }).click()
  await committed
  try {
    await lock(page)
    await page.getByLabel('主密码', { exact: true }).fill(master)
    await page.getByRole('button', { name: '解锁账号库', exact: true }).click()
    await page
      .getByLabel('验证器验证码', { exact: true })
      .fill(generator.generate({ timestamp: Date.now() + 30000 }))
    await page.getByRole('button', { name: '解锁账号库', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: '我的账号库' })
    ).toBeVisible()
    const completed = second.waitForResponse((response) =>
      response.url().endsWith('/api/security/totp/enable')
    )
    release()
    await (await completed).finished()
    await second.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )
    await expect(
      page.getByRole('heading', { name: '我的账号库' })
    ).toBeVisible()
    expect((await context.request.get('/api/vault')).status()).toBe(200)
  } finally {
    release()
    // Reissue recovery credentials and use recovery to clear TOTP for the next test.
    const restored = await rewrapWithMaster(master, master, profile)
    const headers = { 'x-keyfolio': '1', origin: new URL(page.url()).origin }
    const reset = await context.request.post('/api/auth/credentials', {
      headers,
      data: {
        currentProof: restored.currentProof,
        credentials: restored.credentials,
      },
    })
    expect(reset.status()).toBe(200)
    const recovered = await context.request.post('/api/auth/recover', {
      headers,
      data: {
        currentRecoveryProof: restored.credentials.recoveryProof,
        credentials: restored.credentials,
      },
    })
    expect(recovered.status()).toBe(200)
  }
})

test('backup identity conflicts are explained during preview and no import is committed', async ({
  page,
}) => {
  await unlock(page)
  const created = await createCredentials('backup-owner', master)
  const imported = emptyVault()
  imported.subjects.push({
    id: 'foreign',
    name: '星河',
    aliases: [],
    type: 'company',
    color: 'blue',
  })
  const backup = await makeBackup(imported, created.key, {
    username: created.credentials.username,
    kdfSalt: created.credentials.kdfSalt,
    wrappedKey: created.credentials.wrappedKey,
    recoveryWrappedKey: created.credentials.recoveryWrappedKey,
    kdfIterations: 600000,
  })
  const before = await page.request.get('/api/vault')
  await settings(page)
  await page.getByRole('button', { name: '导入备份', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'conflict.keyfolio.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  await dialog.getByLabel('备份原主密码', { exact: true }).fill(master)
  await dialog
    .getByRole('button', { name: '查看导入预览', exact: true })
    .click()
  await expect(dialog.getByRole('alert')).toContainText(
    '主体「星河」与「星河科技」'
  )
  await expect(
    dialog.getByRole('button', { name: '确认合并导入', exact: true })
  ).toHaveCount(0)
  const after = await page.request.get('/api/vault')
  expect((await after.json()).revision).toBe((await before.json()).revision)
})
