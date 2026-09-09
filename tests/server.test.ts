import Database from 'better-sqlite3'
import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import { buildApp } from '../server/app'
import { totp } from '../server/security'
import { type PublicProfile, type VaultResponse } from '../shared/protocol'
import {
  createCredentials,
  decryptVault,
  encryptVault,
  recoverCredentials,
  rewrapWithMaster,
} from '../src/vault/lib/crypto'
import { fixtureVault, master, nextMaster } from './fixtures'

mkdirSync(resolve('work/tests'), { recursive: true })
const directory = mkdtempSync(resolve('work/tests/server-'))
let app: Awaited<ReturnType<typeof buildApp>>
let credentials: Awaited<ReturnType<typeof createCredentials>>
let key: CryptoKey
let profile: PublicProfile
let session = ''
let state: VaultResponse
const baseHeaders = { 'x-keyfolio': '1', origin: 'http://localhost:8188' }
function cookieOf(response: { headers: Record<string, unknown> }) {
  const header = response.headers['set-cookie']
  return (Array.isArray(header) ? header[0] : (header as string)).split(';')[0]
}
before(async () => {
  app = await buildApp({
    dataDir: directory,
    origin: 'http://localhost:8188',
    test: true,
  })
  credentials = await createCredentials('owner', master)
  key = credentials.key
})
after(async () => {
  await app.close()
  rmSync(directory, { recursive: true, force: true })
})
test('first setup creates one owner and a real encrypted vault', async () => {
  const initial = await app.inject({ method: 'GET', url: '/api/auth/status' })
  assert.equal(initial.json().initialized, false)
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    headers: baseHeaders,
    payload: {
      credentials: credentials.credentials,
      payload: await encryptVault(key, fixtureVault()),
    },
  })
  assert.equal(response.statusCode, 200, response.body)
  session = cookieOf(response)
  profile = response.json().profile
  state = response.json().vault
  assert.equal(profile.username, 'owner')
  const anonymous = (await app.inject({ url: '/api/auth/status' })).json()
  assert.equal(anonymous.profile.wrappedKey, undefined)
  assert.equal(anonymous.profile.kdfSalt, profile.kdfSalt)
  assert.deepEqual(
    anonymous.profile.recoveryWrappedKey,
    profile.recoveryWrappedKey
  )
  assert.ok(
    profile.wrappedKey,
    'authenticated setup still returns the master wrapper'
  )
  assert.equal(state.revision, 1)
  assert.match(String(response.headers['set-cookie']), /HttpOnly/i)
  assert.match(String(response.headers['set-cookie']), /SameSite=Strict/i)
  assert.ok(!response.body.includes(credentials.credentials.authProof))
  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    headers: baseHeaders,
    payload: { credentials: credentials.credentials, payload: state.payload },
  })
  assert.equal(duplicate.statusCode, 409)
})
test('vault endpoints require a valid session and browser writes require same-origin verification', async () => {
  assert.equal((await app.inject({ url: '/api/vault' })).statusCode, 401)
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/vault',
        headers: { cookie: session },
        payload: { revision: 1, payload: state.payload },
      })
    ).statusCode,
    403
  )
  const foreign = await app.inject({
    method: 'PUT',
    url: '/api/vault',
    headers: {
      ...baseHeaders,
      cookie: session,
      origin: 'https://attacker.invalid',
    },
    payload: { revision: 1, payload: state.payload },
  })
  assert.equal(foreign.statusCode, 403)
  const get = await app.inject({
    url: '/api/vault',
    headers: { cookie: session },
  })
  assert.equal(get.statusCode, 200)
  assert.equal(get.headers['cache-control'], 'no-store')
  assert.match(
    String(get.headers['content-security-policy']),
    /frame-ancestors 'none'/
  )
})
test('invalid ciphertext envelopes are rejected before database writes', async () => {
  const response = await app.inject({
    method: 'PUT',
    url: '/api/vault',
    headers: { ...baseHeaders, cookie: session },
    payload: { revision: 1, payload: { iv: 'bad', ciphertext: 'plaintext' } },
  })
  assert.equal(response.statusCode, 400)
  assert.equal(
    (
      await app.inject({ url: '/api/vault', headers: { cookie: session } })
    ).json().revision,
    1
  )
})
test('two concurrent device updates cannot silently overwrite each other', async () => {
  const a = fixtureVault(),
    b = fixtureVault()
  a.accounts[0].notes = 'DEVICE_A'
  b.accounts[0].notes = 'DEVICE_B'
  const responses = await Promise.all(
    [a, b].map(async (data) =>
      app.inject({
        method: 'PUT',
        url: '/api/vault',
        headers: { ...baseHeaders, cookie: session },
        payload: {
          revision: state.revision,
          payload: await encryptVault(key, data),
        },
      })
    )
  )
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409])
  state = (
    await app.inject({ url: '/api/vault', headers: { cookie: session } })
  ).json()
  assert.equal(state.revision, 2)
  assert.ok(
    ['DEVICE_A', 'DEVICE_B'].includes(
      (await decryptVault(key, state.payload)).accounts[0].notes
    )
  )
  assert.equal(
    responses.find((r) => r.statusCode === 409)?.json().code,
    'REVISION_CONFLICT'
  )
})
test('SQLite and its journal do not contain platform credentials or notes in plaintext', () => {
  for (const file of readdirSync(directory).filter((f) =>
    f.startsWith('keyfolio.sqlite')
  )) {
    const bytes = readFileSync(join(directory, file))
    for (const value of [
      'PRIVATE_PASSWORD_SENTINEL',
      'PRIVATE_NOTE_SENTINEL',
      'owner@example.invalid',
      'DEVICE_A',
      'DEVICE_B',
    ])
      assert.ok(
        !bytes.includes(Buffer.from(value)),
        `${file} contains ${value}`
      )
  }
})
test('logout revokes the session and only the correct credential can log in again', async () => {
  await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { ...baseHeaders, cookie: session },
    payload: {},
  })
  assert.equal(
    (await app.inject({ url: '/api/vault', headers: { cookie: session } }))
      .statusCode,
    401
  )
  const wrong = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: baseHeaders,
    payload: {
      username: 'owner',
      authProof: Buffer.alloc(32).toString('base64'),
    },
  })
  assert.equal(wrong.statusCode, 401)
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: baseHeaders,
    payload: {
      username: 'owner',
      authProof: credentials.credentials.authProof,
    },
  })
  assert.equal(response.statusCode, 200, response.body)
  session = cookieOf(response)
})
test('online backup is a consistent independently readable SQLite snapshot', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/backup',
    headers: { ...baseHeaders, cookie: session },
    payload: {},
  })
  assert.equal(response.statusCode, 200, response.body)
  const files = readdirSync(join(directory, 'backups')).filter((f) =>
    f.endsWith('.sqlite')
  )
  assert.equal(files.length, 1)
  const snapshot = new Database(join(directory, 'backups', files[0]), {
    readonly: true,
  })
  const row = snapshot.prepare('SELECT revision, payload FROM vault').get() as {
    revision: number
    payload: string
  }
  assert.equal(row.revision, state.revision)
  assert.deepEqual(
    await decryptVault(key, JSON.parse(row.payload)),
    await decryptVault(key, state.payload)
  )
  snapshot.close()
})
test('TOTP enrollment revokes sessions; missing codes and replayed codes are denied', async () => {
  const beforeSession = session
  const started = await app.inject({
    method: 'POST',
    url: '/api/security/totp/start',
    headers: { ...baseHeaders, cookie: session },
    payload: { authProof: credentials.credentials.authProof },
  })
  assert.equal(started.statusCode, 200, started.body)
  const generator = totp(started.json().secret, 'owner')
  const enabled = await app.inject({
    method: 'POST',
    url: '/api/security/totp/enable',
    headers: { ...baseHeaders, cookie: session },
    payload: { otp: generator.generate() },
  })
  assert.equal(enabled.statusCode, 200, enabled.body)
  assert.equal(
    (
      await app.inject({
        url: '/api/vault',
        headers: { cookie: beforeSession },
      })
    ).statusCode,
    401
  )
  const missing = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: baseHeaders,
    payload: {
      username: 'owner',
      authProof: credentials.credentials.authProof,
    },
  })
  assert.equal(missing.json().code, 'TOTP_REQUIRED')
  const code = generator.generate({ timestamp: Date.now() + 30000 })
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: baseHeaders,
    payload: {
      username: 'owner',
      authProof: credentials.credentials.authProof,
      otp: code,
    },
  })
  assert.equal(response.statusCode, 200, response.body)
  session = cookieOf(response)
  const replay = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: baseHeaders,
    payload: {
      username: 'owner',
      authProof: credentials.credentials.authProof,
      otp: code,
    },
  })
  assert.equal(replay.json().code, 'TOTP_INVALID')
})
test('recovery rotates credentials, disables TOTP, revokes sessions and preserves encrypted account data', async () => {
  const oldSession = session
  const recovered = await recoverCredentials(
    credentials.recoveryKey,
    nextMaster,
    (await app.inject({ url: '/api/auth/status' })).json().profile
  )
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/recover',
    headers: baseHeaders,
    payload: {
      currentRecoveryProof: recovered.currentRecoveryProof,
      credentials: recovered.credentials,
    },
  })
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(
    (await app.inject({ url: '/api/vault', headers: { cookie: oldSession } }))
      .statusCode,
    401
  )
  session = cookieOf(response)
  profile = response.json().profile
  key = recovered.key
  assert.deepEqual(
    await decryptVault(key, response.json().vault.payload),
    await decryptVault(key, state.payload)
  )
  const replay = await app.inject({
    method: 'POST',
    url: '/api/auth/recover',
    headers: baseHeaders,
    payload: {
      currentRecoveryProof: recovered.currentRecoveryProof,
      credentials: recovered.credentials,
    },
  })
  assert.equal(replay.statusCode, 401)
  const oldLogin = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: baseHeaders,
    payload: {
      username: 'owner',
      authProof: credentials.credentials.authProof,
    },
  })
  assert.equal(oldLogin.statusCode, 401)
  credentials = recovered
  assert.equal(
    (
      await app.inject({ url: '/api/security', headers: { cookie: session } })
    ).json().totpEnabled,
    false
  )
})
test('master rotation and process restart preserve usable data and invalidate old sessions', async () => {
  const oldSession = session
  const rotated = await rewrapWithMaster(nextMaster, master, profile)
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/credentials',
    headers: { ...baseHeaders, cookie: session },
    payload: {
      currentProof: rotated.currentProof,
      credentials: rotated.credentials,
    },
  })
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(
    (await app.inject({ url: '/api/vault', headers: { cookie: oldSession } }))
      .statusCode,
    401
  )
  await app.close()
  app = await buildApp({
    dataDir: directory,
    origin: 'http://localhost:8188',
    test: true,
  })
  const loggedIn = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: baseHeaders,
    payload: { username: 'owner', authProof: rotated.credentials.authProof },
  })
  assert.equal(loggedIn.statusCode, 200, loggedIn.body)
  assert.equal(loggedIn.json().vault.revision, state.revision)
  assert.deepEqual(
    await decryptVault(rotated.key, loggedIn.json().vault.payload),
    await decryptVault(key, state.payload)
  )
})
