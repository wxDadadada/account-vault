import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import type { ModelProgressOptions } from '../server/ai-provider'
import { buildApp } from '../server/app'
import type { ChatRequest } from '../shared/ai-chat'
import { SSEDecoder } from '../shared/ai-stream'
import { createCredentials, encryptVault } from '../src/vault/lib/crypto'
import { fixtureVault, master } from './fixtures'

test(
  'chat stream sends progress before completion, rejects invalid results, aborts on disconnect and blocks revoked sessions',
  { timeout: 15000 },
  async () => {
    mkdirSync(resolve('work/tests'), { recursive: true })
    const directory = mkdtempSync(resolve('work/tests/stream-api-'))
    const origin = 'http://localhost:8188'
    const headers = { origin, 'x-keyfolio': '1' }
    let release!: (value: unknown) => void
    let active!: ModelProgressOptions
    let calls = 0
    const app = await buildApp({
      dataDir: directory,
      origin,
      test: true,
      chatStreamer: async (_input, options) => {
        calls++
        active = options
        options.onProgress?.({ type: 'thinking', delta: '正在核对' })
        return new Promise((resolve, reject) => {
          release = resolve
          options.signal?.addEventListener(
            'abort',
            () => reject(options.signal?.reason),
            { once: true }
          )
        })
      },
    })
    try {
      const created = await createCredentials('owner', master)
      const setup = await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        headers,
        payload: {
          credentials: created.credentials,
          payload: await encryptVault(created.key, fixtureVault()),
        },
      })
      const cookie = String(setup.headers['set-cookie']).split(';')[0]
      const address = await app.listen({ host: '127.0.0.1', port: 0 })
      const input: ChatRequest = {
        mode: 'capture',
        turns: [{ text: 'GitHub' }],
        context: { items: [], plan: null },
        categories: [],
        config: {
          baseUrl: 'https://api.deepseek.com',
          model: 'synthetic',
          apiKey: 'synthetic',
        },
      }
      const send = (requestCookie = cookie, body: unknown = input) =>
        fetch(`${address}/api/ai/chat`, {
          method: 'POST',
          headers: {
            ...headers,
            cookie: requestCookie,
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
      const invalid = await send('', input)
      assert.equal(invalid.status, 401)
      assert.ok(!invalid.headers.get('content-type')?.includes('event-stream'))
      assert.equal(
        (await send(cookie, { ...input, turns: [{ text: '密码是 secret' }] }))
          .status,
        422
      )
      assert.equal(calls, 0)
      const response = await send()
      assert.equal(response.headers.get('x-accel-buffering'), 'no')
      assert.equal(
        response.headers.get('cache-control'),
        'no-store, no-transform'
      )
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
      const reader = response.body!.getReader()
      const decoder = new SSEDecoder()
      const first = decoder
        .push((await reader.read()).value!)
        .map((value) => JSON.parse(value))
      assert.ok(first.some((event) => event.type === 'thinking'))
      assert.ok(first.every((event) => event.type !== 'result'))
      release({
        mode: 'capture',
        reply: '已整理',
        items: [{ platform: 'GitHub' }],
      })
      const remaining = new TextDecoder().decode((await reader.read()).value)
      assert.match(remaining, /"type":"result"/)
      await reader.cancel()
      const rejected = await send()
      release({
        mode: 'capture',
        reply: '',
        items: [{ platform: 'GitHub', password: 'forbidden' }],
      })
      const rejectedText = await rejected.text()
      assert.match(rejectedText, /"type":"error"/)
      assert.ok(!rejectedText.includes('forbidden'))
      const canceled = await send()
      const canceledSignal = active.signal!
      const aborted = new Promise<void>((resolve) =>
        canceledSignal.addEventListener('abort', () => resolve(), {
          once: true,
        })
      )
      await canceled.body!.cancel()
      await aborted
      assert.equal(canceledSignal.aborted, true)
      const revoked = await send()
      await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { ...headers, cookie },
      })
      release({
        mode: 'capture',
        reply: 'late-result',
        items: [{ platform: 'GitHub' }],
      })
      const revokedText = await revoked.text()
      assert.match(revokedText, /UNAUTHENTICATED/)
      assert.ok(!revokedText.includes('late-result'))
    } finally {
      app.server.closeAllConnections()
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
)
