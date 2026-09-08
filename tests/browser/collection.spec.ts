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
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
async function nav(page: Page, name: string | RegExp) {
  await page.getByRole('link', { name }).filter({ visible: true }).click()
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
  expect(
    (
      await page.request.put('/api/vault', {
        headers: { origin: baseURL!, 'x-keyfolio': '1' },
        data: { revision: current.revision, payload: before.payload },
      })
    ).status()
  ).toBe(200)
})

test('new accounts inherit the selected subject and display choices survive navigation and reload', async ({
  page,
}) => {
  await choose(page, '筛选主体', '星河科技')
  await page
    .getByRole('button', { name: '添加账号', exact: true })
    .filter({ visible: true })
    .first()
    .click()
  await expect(
    page.getByRole('combobox', { name: '所属主体', exact: true })
  ).toContainText('星河科技')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '列表视图', exact: true }).click()
  await nav(page, '设置')
  await nav(page, /^账号库/)
  await expect(
    page.getByRole('button', { name: '列表视图', exact: true })
  ).toHaveAttribute('aria-pressed', 'true')
  await unlock(page)
  await expect(
    page.getByRole('button', { name: '列表视图', exact: true })
  ).toHaveAttribute('aria-pressed', 'true')
})

test('mapped table imports preview duplicates and row errors before writing any data', async ({
  page,
}) => {
  await page.getByRole('button', { name: '导入账号', exact: true }).click()
  await page
    .getByLabel('导入表格内容', { exact: true })
    .fill(
      '平台,账号,密码,所属主体,登录地址\n新云平台,ops@example.com,IMPORT_SECRET_SENTINEL,星河科技,javascript:alert(1)'
    )
  await page.getByRole('button', { name: '读取并对应字段' }).click()
  await page.getByRole('button', { name: '预览 1 行' }).click()
  await expect(
    page.getByRole('button', { name: '确认导入', exact: true })
  ).toBeDisabled()
  await expect(
    page.getByRole('region', { name: '导入逐行预览' })
  ).toContainText('登录地址')
  expect((await (await page.request.get('/api/vault')).json()).payload).toEqual(
    before.payload
  )
  await page.getByRole('button', { name: '返回调整' }).click()
  await page.getByRole('button', { name: '返回内容' }).click()
  await page
    .getByLabel('导入表格内容', { exact: true })
    .fill(
      '平台,账号,密码,所属主体,登录地址\n新云平台,ops@example.com,IMPORT_SECRET_SENTINEL,星河科技,https://example.invalid/login\n设计平台,design@example.com,,星河科技,'
    )
  await page.getByRole('button', { name: '读取并对应字段' }).click()
  await page.getByRole('button', { name: '预览 2 行' }).click()
  await expect(
    page.getByRole('region', { name: '导入逐行预览' })
  ).not.toContainText('IMPORT_SECRET_SENTINEL')
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.entry-card')).toHaveCount(3)
  const encrypted = JSON.stringify(
    (await (await page.request.get('/api/vault')).json()).payload
  )
  expect(encrypted).not.toContain('IMPORT_SECRET_SENTINEL')
  await page.screenshot({
    path: test.info().outputPath('imported-collection.png'),
  })
})

test('bulk editing, encrypted saved views and recycle bin restoration work together', async ({
  page,
}) => {
  await page.getByRole('checkbox', { name: '选择当前筛选的全部账号' }).check()
  await page.getByRole('button', { name: '批量整理', exact: true }).click()
  await choose(page, '批量所属主体', '星河科技')
  await choose(page, '批量状态', '待完善')
  await page.getByLabel('添加标签', { exact: true }).fill('整批回归')
  await page.getByRole('button', { name: '确认批量修改' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await choose(page, '筛选主体', '星河科技')
  await page.getByRole('button', { name: '高级筛选' }).click()
  await page.getByRole('button', { name: '整批回归', exact: true }).click()
  await page.getByRole('button', { name: '保存为视图' }).click()
  await page.getByLabel('视图名称').fill('公司待完善')
  await page.getByRole('button', { name: '保存视图', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await unlock(page)
  await page.getByRole('button', { name: '公司待完善', exact: true }).click()
  await expect(page.locator('.entry-card')).toHaveCount(1)
  await expect(page.getByRole('combobox', { name: '筛选主体' })).toContainText(
    '星河科技'
  )
  await page.getByRole('checkbox', { name: '选择当前筛选的全部账号' }).check()
  await page
    .getByRole('region', { name: '批量操作' })
    .getByRole('button', { name: '移入回收站' })
    .click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '移入回收站' })
    .click()
  await expect(page.locator('.entry-card')).toHaveCount(0)
  await page.getByRole('button', { name: '账号工具', exact: true }).click()
  await page.getByRole('menuitem', { name: /^回收站/ }).click()
  await expect(page.getByRole('dialog')).toContainText('测试云平台')
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await page.getByRole('button', { name: '确认恢复', exact: true }).click()
  await expect(page.getByText('回收站是空的')).toBeVisible()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await expect(page.locator('.entry-card')).toHaveCount(1)
})

test('custom secrets, aliases, expiration and account TOTP persist securely and stay hidden in history', async ({
  page,
}) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/vault') && request.method() === 'PUT')
      writes.push(request.postData() ?? '')
  })
  await page.locator('.account-card-main').first().click()
  await page.getByRole('button', { name: '编辑账号', exact: true }).click()
  await page.getByLabel('账号别名', { exact: true }).fill('公司生产主号')
  await page.getByRole('button', { name: '到期与提醒', exact: true }).click()
  await page.getByLabel('到期日期', { exact: true }).fill('2026-01-01')
  await page
    .getByRole('button', { name: '账号验证码（TOTP）', exact: true })
    .click()
  await page
    .getByLabel('验证码密钥', { exact: true })
    .fill('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  await page.getByRole('button', { name: '自定义字段', exact: true }).click()
  await page
    .getByRole('button', { name: '添加自定义字段', exact: true })
    .click()
  await page.getByLabel('字段 1 名称', { exact: true }).fill('部署 Token')
  await page
    .getByLabel('字段 1 内容', { exact: true })
    .fill('EXTRA_SECRET_SENTINEL')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(writes.join('')).not.toContain('EXTRA_SECRET_SENTINEL')
  expect(writes.join('')).not.toContain('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  await page
    .getByRole('textbox', { name: '搜索账号', exact: true })
    .fill('公司生产主号')
  await expect(page.locator('.entry-card')).toHaveCount(1)
  await page.locator('.account-card-main').first().click()
  await expect(page.locator('.totp-code')).toHaveText(/\d{3} \d{3}/)
  await expect(page.getByRole('dialog')).not.toContainText(
    'EXTRA_SECRET_SENTINEL'
  )
  await page.getByRole('button', { name: '显示部署 Token' }).click()
  await expect(
    page.getByText('EXTRA_SECRET_SENTINEL', { exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: '变更记录 1' }).click()
  await page.locator('.history-event-title').click()
  await expect(page.locator('.change-diff')).not.toContainText(
    'EXTRA_SECRET_SENTINEL'
  )
  await expect(page.locator('.change-diff')).not.toContainText(
    'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  )
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await unlock(page)
  await page.locator('.account-card-main').first().click()
  await expect(
    page.getByRole('heading', { name: '公司生产主号' })
  ).toBeVisible()
  await expect(page.locator('.totp-code')).toHaveText(/\d{3} \d{3}/)
})

test('collection tools and dense layouts fit narrow, large-text and dark screens', async ({
  page,
}, info) => {
  for (const width of info.project.name === 'mobile'
    ? [375, 390]
    : [1280, 1440]) {
    await page.setViewportSize({
      width,
      height: info.project.name === 'mobile' ? 844 : 900,
    })
    await expect(page.locator('.entry-card').first()).toBeInViewport()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true)
  }
  await page.getByRole('button', { name: /^账号检查/ }).click()
  await expect(page.getByRole('dialog')).toContainText('本地')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '列表视图', exact: true }).click()
  await page.screenshot({ path: test.info().outputPath('collection-list.png') })
  await page.evaluate(() => {
    document.documentElement.classList.add('dark')
    document.documentElement.style.fontSize = '20px'
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: test.info().outputPath('collection-dark-large-text.png'),
  })
})
