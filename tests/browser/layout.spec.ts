import { expect, test, type Page } from '@playwright/test'

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
}
async function navigate(page: Page, name: string | RegExp, heading: string) {
  const link = page
    .getByRole('link', { name, exact: true })
    .filter({ visible: true })
  await link.click()
  await expect(
    page.getByRole('heading', { name: heading, exact: true })
  ).toBeVisible()
  await expect(link).toHaveAttribute('aria-current', 'page')
  await noOverflow(page)
}

test('workspace navigation remains reachable across account sheets, taxonomy tabs and long settings pages', async ({
  page,
}, info) => {
  if (info.project.name === 'mobile')
    await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await page.getByRole('button', { name: '体验示例空间', exact: true }).click()
  await expect(page.getByRole('heading', { name: '我的账号库' })).toBeVisible()
  await noOverflow(page)
  const firstAccount = await page.locator('.entry-card').first().boundingBox()
  expect(firstAccount!.y + firstAccount!.height).toBeLessThan(
    page.viewportSize()!.height - (info.project.name === 'mobile' ? 70 : 0)
  )
  await expect(
    page.getByRole('button', { name: '列表视图', exact: true })
  ).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.entry-main').first().click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '开始记录', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '拾钥 AI 助手' })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await navigate(page, /^(主体与分类|主体)$/, '主体与分类')
  for (const label of ['分类', '标签', '主体']) {
    const tab = page
      .getByRole('button', { name: new RegExp('^' + label + '\\s*\\d') })
      .filter({ visible: true })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-pressed', 'true')
    await noOverflow(page)
  }
  await navigate(page, /^(变更记录|动态)$/, '变更记录')
  await expect(page.locator('.history-day')).not.toHaveCount(0)
  await page.locator('.timeline-row').first().click()
  await expect(page.locator('.change-diff')).toBeVisible()
  await navigate(page, '设置', '设置')
  await page.getByRole('link', { name: 'AI 整理助手', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '保存配置', exact: true })
  ).toBeVisible()
  await navigate(page, /^账号库$/, '我的账号库')
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await page.screenshot({
    path: test.info().outputPath('workspace-navigation.png'),
  })
})

test('taxonomy navigation and forms fit enlarged dark mobile text and a tablet viewport', async ({
  page,
}, info) => {
  await page.setViewportSize(
    info.project.name === 'mobile'
      ? { width: 375, height: 812 }
      : { width: 900, height: 768 }
  )
  await page.goto('/')
  await page.getByRole('button', { name: '体验示例空间', exact: true }).click()
  await page.evaluate(() => {
    document.documentElement.classList.add('dark')
    document.documentElement.style.fontSize = '20px'
  })
  await navigate(page, /^(主体与分类|主体)$/, '主体与分类')
  await page.getByRole('button', { name: /^分类\s*\d/ }).click()
  await noOverflow(page)
  await page.getByRole('button', { name: '添加分类', exact: true }).click()
  await page.getByLabel('分类名称', { exact: true }).fill('草稿分类')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('分类名称', { exact: true })).toHaveValue(
    '草稿分类'
  )
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await navigate(page, /^(变更记录|动态)$/, '变更记录')
})
