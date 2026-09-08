import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { buildApp } from '../server/app'
import { chatRequestSchema, type ChatRequest } from '../shared/ai-chat'
import { createCredentials, encryptVault } from '../src/vault/lib/crypto'
import { fixtureVault, master } from './fixtures'

test('authenticated chat validates both directions, forwards context, and never saves the vault', async () => {
  mkdirSync(resolve('work/tests'), { recursive: true })
  const directory = mkdtempSync(resolve('work/tests/chat-api-'))
  const origin = 'http://localhost:4318'
  const headers = { origin, 'x-keyfolio': '1' }
  const calls: ChatRequest[] = []
  let result: unknown = {
    mode: 'capture',
    reply: '请补充账号',
    items: [{ platform: 'GitHub' }],
  }
  let pending: (() => Promise<unknown>) | undefined
  const app = await buildApp({
    dataDir: directory,
    origin,
    test: true,
    chatCaller: async (input) => {
      calls.push(input)
      return pending ? pending() : result
    },
  })
  try {
    const credentials = await createCredentials('owner', master)
    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers,
      payload: {
        credentials: credentials.credentials,
        payload: await encryptVault(credentials.key, fixtureVault()),
      },
    })
    assert.equal(setup.statusCode, 200)
    const cookie = String(setup.headers['set-cookie']).split(';')[0]
    const input: ChatRequest = {
      mode: 'capture',
      turns: [
        { text: 'GitHub' },
        { text: 'a', field: 'username', itemIndex: 0 },
      ],
      context: {
        items: [{ action: 'create', platform: 'GitHub', draftId: 'draft-1' }],
        plan: null,
      },
      categories: ['开发工具'],
      config: {
        baseUrl: 'https://api.deepseek.com',
        model: 'synthetic',
        apiKey: 'synthetic-key',
      },
    }
    const send = (
      payload: unknown = input,
      requestHeaders = { ...headers, cookie }
    ) =>
      app.inject({
        method: 'POST',
        url: '/api/ai/chat',
        headers: requestHeaders,
        payload: payload as object,
      })
    assert.equal(
      (await send(input, { ...headers, cookie: '' })).statusCode,
      401
    )
    assert.equal(
      (
        await send(input, {
          ...headers,
          cookie,
          origin: 'https://foreign.invalid',
        })
      ).statusCode,
      403
    )
    assert.equal(calls.length, 0)
    const before = (
      await app.inject({ url: '/api/vault', headers: { cookie } })
    ).json()
    assert.equal((await send()).statusCode, 200)
    assert.deepEqual(calls[0], chatRequestSchema.parse(input))
    assert.deepEqual(
      (await app.inject({ url: '/api/vault', headers: { cookie } })).json(),
      before
    )
    assert.equal(
      (await send({ ...input, turns: [{ text: '密码是 secret' }] })).statusCode,
      422
    )
    assert.equal(
      (
        await send({
          ...input,
          context: {
            ...input.context,
            items: [{ platform: 'GitHub', notes: 'API Key: secret' }],
          },
        })
      ).statusCode,
      422
    )
    assert.equal(
      (
        await send({
          ...input,
          context: {
            ...input.context,
            items: [{ platform: 'GitHub', password: 'secret' }],
          },
        })
      ).statusCode,
      400
    )
    assert.equal(
      calls.length,
      1,
      'invalid or sensitive input never reaches the model'
    )
    for (const invalid of [
      { mode: 'search', reply: '', plan: { keywords: [] } },
      {
        mode: 'capture',
        reply: '',
        items: [{ platform: 'GitHub', password: 'secret' }],
      },
      {
        mode: 'capture',
        reply: '',
        items: [{ platform: 'GitHub', action: 'delete' }],
      },
    ]) {
      result = invalid
      assert.equal((await send()).statusCode, 422)
    }
    result = {
      mode: 'search',
      reply: '已补充主体条件',
      plan: { keywords: ['GitHub'], subject: '我个人' },
    }
    const searchInput = {
      ...input,
      mode: 'search',
      turns: [{ text: '只看我个人的', field: 'criteria' }],
      context: { items: [], plan: { keywords: ['GitHub'] } },
    }
    assert.equal((await send(searchInput)).statusCode, 200)
    assert.deepEqual(calls[calls.length - 1].context.plan, {
      keywords: ['GitHub'],
    })
    let release!: (value: unknown) => void
    let started!: () => void
    const waiting = new Promise<void>((resolve) => {
      started = resolve
    })
    pending = () => {
      started()
      return new Promise((resolve) => {
        release = resolve
      })
    }
    const delayed = send()
    void delayed.then(() => {})
    await waiting
    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { ...headers, cookie },
    })
    assert.equal(logout.statusCode, 200)
    release({ mode: 'capture', reply: '', items: [{ platform: 'GitHub' }] })
    assert.equal(
      (await delayed).statusCode,
      401,
      'revoked sessions cannot receive a late chat reply'
    )
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
