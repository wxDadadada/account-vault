import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildApp } from '../server/app'
import { createCredentials, encryptVault } from '../src/vault/lib/crypto'
import { fixtureVault, master } from '../tests/fixtures'

// Dedicated synthetic data; never load .env or the normal application data path.
mkdirSync(resolve('work/tests'), { recursive: true })
const directory = mkdtempSync(resolve('work/tests/browser-'))
const port = Number(process.env.E2E_PORT ?? 44987)
const origin = `http://127.0.0.1:${port}`
const app = await buildApp({
  dataDir: directory,
  origin,
  staticDir: resolve('dist'),
  test: true,
  chatCaller: async () => {
    throw new Error('浏览器测试需要模拟模型回复')
  },
})
let closing = false
async function close() {
  if (closing) return
  closing = true
  await app.close()
  rmSync(directory, { recursive: true, force: true })
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => void close().then(() => process.exit(0)))
try {
  const created = await createCredentials('owner', master)
  const data = fixtureVault()
  data.preferences.autoLockMinutes = 1
  data.subjects.push({
    id: 'company',
    name: '星河科技',
    aliases: ['星河'],
    type: 'company',
    color: 'blue',
  })
  const setup = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    headers: { origin, 'x-keyfolio': '1' },
    payload: {
      credentials: created.credentials,
      payload: await encryptVault(created.key, data),
    },
  })
  if (setup.statusCode !== 200) throw new Error('Browser fixture setup failed')
  await app.listen({ host: '127.0.0.1', port })
} catch (error) {
  await close()
  throw error
}
