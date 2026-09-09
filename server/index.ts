import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildApp } from './app.js'

process.umask(0o077)
const port = Number(process.env.PORT ?? 8188)
const dataDir = resolve(process.env.DATA_DIR ?? './data')
const origin = process.env.APP_ORIGIN ?? `http://localhost:${port}`
let setupToken: string | undefined
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const tokenPath = resolve(dataDir, 'setup-token')
  if (!existsSync(tokenPath))
    writeFileSync(tokenPath, randomBytes(24).toString('base64url'), {
      mode: 0o600,
      flag: 'wx',
    })
  setupToken = readFileSync(tokenPath, 'utf8').trim()
}
const app = await buildApp({
  dataDir,
  origin,
  setupToken,
  trustedProxies: process.env.TRUSTED_PROXIES?.split(',')
    .map((p) => p.trim())
    .filter(Boolean),
  staticDir: resolve('dist'),
  backupDir: process.env.BACKUP_DIR
    ? resolve(process.env.BACKUP_DIR)
    : undefined,
  aiHosts: process.env.AI_ALLOWED_HOSTS?.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
})
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' })
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => void app.close().then(() => process.exit(0)))
