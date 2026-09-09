import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
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
  chatStreamer: async (input, options) => {
    const text = input.turns.at(-1)!.text
    if (!text.startsWith('流式测试'))
      throw new Error('浏览器测试需要模拟模型回复')
    options.onProgress?.({
      type: 'thinking',
      delta: '先保留已有字段，再核对新信息。',
    })
    await delay(250, undefined, { signal: options.signal })
    options.onProgress?.({ type: 'reply', text: '已经识别' })
    await delay(250, undefined, { signal: options.signal })
    options.onProgress?.({ type: 'reply', text: '已经识别这次补充。' })
    await delay(1800, undefined, { signal: options.signal })
    if (text.includes('失败'))
      return {
        mode: 'capture',
        reply: '错误回复',
        items: [{ platform: 'GitHub', password: 'must-reject' }],
      }
    return {
      mode: 'capture',
      reply: '已经识别这次补充。',
      items: [
        {
          ...input.context.items[0],
          platform: 'GitHub',
          username: 'stream-user',
          subject: '我个人',
        },
      ],
    }
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
