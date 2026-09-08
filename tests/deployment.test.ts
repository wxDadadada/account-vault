import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { buildApp } from '../server/app'
import { createCredentials, encryptVault } from '../src/vault/lib/crypto'
import { fixtureVault, master } from './fixtures'

mkdirSync(resolve('work/tests'), { recursive: true })
test('remote setup requires a server token and issues a secure host-only cookie', async () => {
  const directory = mkdtempSync(resolve('work/tests/deployment-'))
  const app = await buildApp({
    dataDir: directory,
    origin: 'https://vault.example.invalid',
    setupToken: 'test-server-token',
    trustedProxies: ['127.0.0.1'],
    test: true,
  })
  try {
    const status = await app.inject({ url: '/api/auth/status' })
    assert.equal(status.json().requiresSetupToken, true)
    const credentials = await createCredentials('owner', master)
    const payload = {
      credentials: credentials.credentials,
      payload: await encryptVault(credentials.key, fixtureVault()),
    }
    const headers = {
      origin: 'https://vault.example.invalid',
      'x-keyfolio': '1',
    }
    for (const token of [undefined, 'incorrect-token']) {
      const denied = await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        headers,
        payload: { ...payload, ...(token ? { setupToken: token } : {}) },
      })
      assert.equal(denied.statusCode, 403)
      assert.equal(
        (await app.inject({ url: '/api/auth/status' })).json().initialized,
        false
      )
    }
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers,
      payload: { ...payload, setupToken: 'test-server-token' },
    })
    assert.equal(accepted.statusCode, 200)
    const session = String(accepted.headers['set-cookie'])
    assert.match(session, /^__Host-keyfolio=/)
    assert.match(session, /; Secure/)
    assert.match(session, /; Path=\//)
    assert.doesNotMatch(session, /Domain=/)
    const crossSite = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        ...headers,
        cookie: session.split(';')[0],
        'sec-fetch-site': 'cross-site',
      },
      payload: {},
    })
    assert.equal(crossSite.statusCode, 403)
    const backupHeaders = { ...headers, cookie: session.split(';')[0] }
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/backup',
          headers: backupHeaders,
          payload: {},
        })
      ).statusCode,
      200
    )
    rmSync(join(directory, 'backups'), { recursive: true })
    writeFileSync(
      join(directory, 'backups'),
      'This file deliberately blocks the backup directory'
    )
    const failed = await app.inject({
      method: 'POST',
      url: '/api/backup',
      headers: backupHeaders,
      payload: {},
    })
    assert.equal(
      failed.statusCode,
      500,
      'a failed new backup must not report the previous success'
    )
    assert.equal(failed.json().lastBackupAt, undefined)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
test('remote insecure origins and absent initialization tokens are rejected at startup', async () => {
  await assert.rejects(
    buildApp({
      dataDir: 'work/tests/unused',
      origin: 'http://vault.example.invalid',
      test: true,
    }),
    /HTTPS/
  )
  await assert.rejects(
    buildApp({
      dataDir: 'work/tests/unused',
      origin: 'https://vault.example.invalid',
      test: true,
    }),
    /初始化令牌/
  )
  await assert.rejects(
    buildApp({
      dataDir: 'work/tests/unused',
      origin: 'https://vault.example.invalid',
      setupToken: 'test-token',
      test: true,
    }),
    /TRUSTED_PROXIES/
  )
})
