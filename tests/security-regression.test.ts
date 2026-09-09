import Database from 'better-sqlite3'
import assert from 'node:assert/strict'
import { createHook } from 'node:async_hooks'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { buildApp, type AppOptions } from '../server/app'
import { validateTrustedProxies } from '../server/proxy'
import { totp } from '../server/security'
import {
  createCredentials,
  decryptVault,
  encryptVault,
  rewrapWithMaster,
} from '../src/vault/lib/crypto'
import { fixtureVault, master, nextMaster } from './fixtures'

const headers = { 'x-keyfolio': '1', origin: 'http://localhost:8188' }
const cookieOf = (response: { headers: Record<string, unknown> }) =>
  String(response.headers['set-cookie']).split(';')[0]
const wrongProof = Buffer.alloc(32).toString('base64')

async function fixture(t: TestContext, options: Partial<AppOptions> = {}) {
  mkdirSync(resolve('work/tests'), { recursive: true })
  const directory = mkdtempSync(resolve('work/tests/regression-'))
  const app = await buildApp({
    dataDir: directory,
    origin: headers.origin,
    test: true,
    ...options,
  })
  t.after(async () => {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  })
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
  assert.equal(setup.statusCode, 200, setup.body)
  return {
    app,
    directory,
    created,
    session: cookieOf(setup),
    profile: setup.json().profile,
    vault: setup.json().vault,
  }
}

for (const revocation of ['totp', 'logout', 'expiry'] as const) {
  test(
    `credential rotation cannot outlive ${revocation} revocation during real scrypt`,
    { timeout: 15000 },
    async (t) => {
      const { app, directory, created, session, profile, vault } =
        await fixture(t)
      const rotated = await rewrapWithMaster(master, nextMaster, profile)
      let code = ''
      let generator: ReturnType<typeof totp> | undefined
      if (revocation === 'totp') {
        const started = await app.inject({
          method: 'POST',
          url: '/api/security/totp/start',
          headers: { ...headers, cookie: session },
          payload: { authProof: created.credentials.authProof },
        })
        assert.equal(started.statusCode, 200, started.body)
        generator = totp(started.json().secret, 'owner')
        code = generator.generate()
      }
      let markStarted!: () => void
      const started = new Promise<void>((resolve) => {
        markStarted = resolve
      })
      // Observe the real crypto boundary after requireSession, without mocking it.
      const hook = createHook({
        init(_id, type) {
          if (type === 'SCRYPTREQUEST') {
            hook.disable()
            markStarted()
          }
        },
      })
      t.after(() => hook.disable())
      hook.enable()
      const pending = app
        .inject({
          method: 'POST',
          url: '/api/auth/credentials',
          headers: { ...headers, cookie: session },
          payload: {
            currentProof: rotated.currentProof,
            credentials: rotated.credentials,
          },
        })
        .then((response) => response)
      await started
      if (revocation === 'totp') {
        const enabled = await app.inject({
          method: 'POST',
          url: '/api/security/totp/enable',
          headers: { ...headers, cookie: session },
          payload: { otp: code },
        })
        assert.equal(enabled.statusCode, 200, enabled.body)
      } else if (revocation === 'logout') {
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/auth/logout',
              headers: { ...headers, cookie: session },
              payload: {},
            })
          ).statusCode,
          200
        )
      } else {
        const db = new Database(join(directory, 'keyfolio.sqlite'))
        db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1)
        db.close()
      }
      assert.equal(
        (await app.inject({ url: '/api/vault', headers: { cookie: session } }))
          .statusCode,
        401
      )
      const denied = await pending
      assert.equal(denied.statusCode, 401, denied.body)
      assert.equal(denied.json().code, 'UNAUTHENTICATED')
      assert.equal(denied.headers['set-cookie'], undefined)
      const status = (await app.inject({ url: '/api/auth/status' })).json()
      assert.equal(
        status.profile.kdfSalt,
        profile.kdfSalt,
        'revoked writes must leave credentials unchanged'
      )
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers,
        payload: {
          username: 'owner',
          authProof: created.credentials.authProof,
          ...(generator
            ? { otp: generator.generate({ timestamp: Date.now() + 30000 }) }
            : {}),
        },
      })
      assert.equal(login.statusCode, 200, login.body)
      assert.deepEqual(
        await decryptVault(created.key, login.json().vault.payload),
        await decryptVault(created.key, vault.payload)
      )
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/api/auth/recover',
            headers,
            payload: {
              currentRecoveryProof: rotated.credentials.recoveryProof,
              credentials: rotated.credentials,
            },
          })
        ).statusCode,
        401,
        'the rejected recovery credential must not become valid'
      )
    }
  )
}

test('trusted proxy clients have independent authentication budgets and correct 429 responses', async (t) => {
  const { app, created } = await fixture(t, {
    test: false,
    trustedProxies: ['127.0.0.1'],
  })
  const login = (ip: string, proof = wrongProof) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '127.0.0.1',
      headers: { ...headers, 'x-forwarded-for': ip },
      payload: { username: 'owner', authProof: proof },
    })
  for (let i = 0; i < 8; i++)
    assert.equal((await login('198.51.100.1')).statusCode, 401)
  const blocked = await login('198.51.100.1', created.credentials.authProof)
  assert.equal(blocked.statusCode, 429, blocked.body)
  assert.equal(blocked.json().code, 'RATE_LIMITED')
  assert.ok(Number(blocked.headers['retry-after']) > 0)
  assert.equal(
    (await login('198.51.100.2', created.credentials.authProof)).statusCode,
    200
  )
})

test('untrusted forwarded addresses and forged cookies cannot create fresh rate-limit buckets', async (t) => {
  const { app } = await fixture(t, {
    test: false,
    trustedProxies: ['127.0.0.1'],
  })
  for (let i = 0; i < 9; i++) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '203.0.113.9',
      headers: {
        ...headers,
        'x-forwarded-for': `198.51.100.${i + 1}`,
        cookie: `keyfolio_session=forged-${i}`,
      },
      payload: { username: 'owner', authProof: wrongProof },
    })
    assert.equal(response.statusCode, i < 8 ? 401 : 429, response.body)
  }
})

test('anonymous quota exhaustion does not block valid sessions, writes or logout', async (t) => {
  const { app, session, vault } = await fixture(t, { test: false })
  for (let i = 0; i < 180; i++)
    assert.equal(
      (await app.inject({ url: '/api/auth/status' })).statusCode,
      200
    )
  for (const cookie of [
    '',
    'keyfolio_session=forged-a',
    'keyfolio_session=forged-b',
  ]) {
    const blocked = await app.inject({
      url: '/api/auth/status',
      headers: { cookie },
    })
    assert.equal(blocked.statusCode, 429, blocked.body)
  }
  assert.equal(
    (await app.inject({ url: '/api/vault', headers: { cookie: session } }))
      .statusCode,
    200
  )
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/vault',
        headers: { ...headers, cookie: session },
        payload: { revision: vault.revision, payload: vault.payload },
      })
    ).statusCode,
    200
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { ...headers, cookie: session },
        payload: {},
      })
    ).statusCode,
    200
  )
  assert.equal(
    (await app.inject({ url: '/api/vault', headers: { cookie: session } }))
      .statusCode,
    429,
    'a revoked cookie must fall back to the exhausted anonymous bucket'
  )
})

test('proxy configuration rejects unrestricted trust and preserves precise IP/CIDR rules', () => {
  for (const address of [
    'true',
    '*',
    '0.0.0.0/0',
    '::/0',
    '::ffff:0:0/96',
    '::ffff:0.0.0.0/96',
    '::/80',
    'localhost',
    'not-an-ip',
  ])
    assert.throws(() => validateTrustedProxies([address]), /TRUSTED_PROXIES/)
  assert.deepEqual(
    validateTrustedProxies(['127.0.0.1', '::1', '172.18.0.1/32']),
    ['127.0.0.1', '::1', '172.18.0.1/32']
  )
})
