import { defineConfig } from '@playwright/test'

const origin = `http://127.0.0.1:${process.env.E2E_PORT ?? 44987}`
export default defineConfig({
  testDir: './tests/browser',
  outputDir: './work/browser-results',
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  use: {
    baseURL: origin,
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'pnpm exec tsx scripts/browser-fixture.ts',
    url: `${origin}/api/health`,
    reuseExistingServer: false,
    timeout: 30000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    env: { NODE_ENV: 'production' },
  },
})
