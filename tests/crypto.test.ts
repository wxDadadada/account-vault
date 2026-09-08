import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { KDF_ITERATIONS, type PublicProfile } from '../shared/protocol'
import {
  createCredentials,
  decryptVault,
  deriveMaster,
  encryptVault,
  makeBackup,
  readBackup,
  recoverCredentials,
  rewrapWithMaster,
  unlockMaster,
  generatePassword,
} from '../src/vault/lib/crypto'
import { fixtureVault, master, nextMaster } from './fixtures'

let created: Awaited<ReturnType<typeof createCredentials>>
let profile: PublicProfile
before(async () => {
  created = await createCredentials('owner', master)
  profile = {
    username: 'owner',
    kdfSalt: created.credentials.kdfSalt,
    wrappedKey: created.credentials.wrappedKey,
    recoveryWrappedKey: created.credentials.recoveryWrappedKey,
    kdfIterations: KDF_ITERATIONS,
  }
})
test('vault roundtrip preserves Chinese text and passwords without plaintext in the envelope', async () => {
  const data = fixtureVault()
  const encrypted = await encryptVault(created.key, data)
  assert.ok(!JSON.stringify(encrypted).includes(data.accounts[0].password))
  assert.ok(!JSON.stringify(encrypted).includes(data.accounts[0].username))
  assert.deepEqual(await decryptVault(created.key, encrypted), data)
  assert.notDeepEqual(
    await encryptVault(created.key, data),
    encrypted,
    'fresh nonce for every save'
  )
})
test('wrong password and ciphertext tampering are rejected', async () => {
  await assert.rejects(unlockMaster('not the master password', profile))
  const encrypted = await encryptVault(created.key, fixtureVault())
  const bytes = Buffer.from(encrypted.ciphertext, 'base64')
  bytes[15] ^= 1
  await assert.rejects(
    decryptVault(created.key, {
      ...encrypted,
      ciphertext: bytes.toString('base64'),
    })
  )
  await assert.rejects(
    decryptVault(created.key, created.credentials.wrappedKey),
    'purpose-bound authenticated encryption'
  )
})
test('authentication proof does not serve as an AES wrapping key', async () => {
  const derived = await deriveMaster(master, profile.kdfSalt)
  assert.equal(derived.authProof, created.credentials.authProof)
  const proofKey = await crypto.subtle.importKey(
    'raw',
    Buffer.from(derived.authProof, 'base64'),
    'AES-GCM',
    false,
    ['decrypt']
  )
  await assert.rejects(
    crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: Buffer.from(profile.wrappedKey.iv, 'base64'),
        additionalData: new TextEncoder().encode('keyfolio:v1:master-wrap'),
      },
      proofKey,
      Buffer.from(profile.wrappedKey.ciphertext, 'base64')
    )
  )
})
test('portable backups restore through either the original master password or recovery key', async () => {
  const data = fixtureVault()
  const backup = JSON.stringify(await makeBackup(data, created.key, profile))
  assert.deepEqual(await readBackup(backup, master, false), data)
  assert.deepEqual(await readBackup(backup, created.recoveryKey, true), data)
  await assert.rejects(readBackup(backup, nextMaster, false))
  const changed = JSON.parse(backup)
  changed.profile.kdfIterations = 1
  await assert.rejects(readBackup(JSON.stringify(changed), master, false))
})
test('password rotation and recovery keep the data key but issue fresh recovery credentials', async () => {
  const encrypted = await encryptVault(created.key, fixtureVault())
  const rotated = await rewrapWithMaster(master, nextMaster, profile)
  assert.notEqual(rotated.recoveryKey, created.recoveryKey)
  assert.deepEqual(
    await decryptVault(rotated.key, encrypted),
    await decryptVault(created.key, encrypted)
  )
  const recovered = await recoverCredentials(
    created.recoveryKey,
    nextMaster,
    profile
  )
  assert.deepEqual(
    await decryptVault(recovered.key, encrypted),
    await decryptVault(created.key, encrypted)
  )
})
test('generated passwords have requested length and vary', () => {
  const values = Array.from({ length: 40 }, () => generatePassword())
  assert.ok(
    values.every((v) => v.length === 24 && /^[A-Za-z0-9!@#$%&*+_=-]+$/.test(v))
  )
  assert.equal(new Set(values).size, 40)
})
