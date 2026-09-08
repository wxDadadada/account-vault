import {
  type BackupFile,
  type Credentials,
  type Envelope,
  type PublicProfile,
  type LoginProfile,
  KDF_ITERATIONS,
  backupSchema,
} from '../../../shared/protocol'
import { type VaultData } from './model'
import { validateVault } from './validation'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
export function toBase64(data: Uint8Array) {
  let binary = ''
  for (let i = 0; i < data.length; i += 8192)
    binary += String.fromCharCode(...data.subarray(i, i + 8192))
  return btoa(binary)
}
export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}
export const randomBase64 = () =>
  toBase64(crypto.getRandomValues(new Uint8Array(32)))
async function aesKey(raw: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}
export async function deriveMaster(master: string, salt: string) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(master),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: fromBase64(salt),
        iterations: KDF_ITERATIONS,
        hash: 'SHA-256',
      },
      material,
      512
    )
  )
  const wrappingKey = await aesKey(bits.slice(0, 32))
  const authProof = toBase64(bits.slice(32))
  bits.fill(0)
  return { wrappingKey, authProof }
}
async function encryptBytes(
  key: CryptoKey,
  data: Uint8Array<ArrayBuffer>,
  purpose: string
): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(`keyfolio:v1:${purpose}`),
    },
    key,
    data
  )
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) }
}
async function decryptBytes(
  key: CryptoKey,
  envelope: Envelope,
  purpose: string
) {
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(envelope.iv),
        additionalData: encoder.encode(`keyfolio:v1:${purpose}`),
      },
      key,
      fromBase64(envelope.ciphertext)
    )
  )
}
export async function encryptVault(key: CryptoKey, data: VaultData) {
  return encryptBytes(
    key,
    encoder.encode(JSON.stringify(validateVault(data))),
    'vault'
  )
}
export async function decryptVault(
  key: CryptoKey,
  envelope: Envelope
): Promise<VaultData> {
  const raw = await decryptBytes(key, envelope, 'vault')
  try {
    return validateVault(JSON.parse(decoder.decode(raw)))
  } finally {
    raw.fill(0)
  }
}
export async function recoveryProofFor(recoveryKey: string) {
  const bytes = fromBase64(recoveryKey.trim())
  if (bytes.length !== 32) throw new Error('恢复密钥格式不正确')
  const label = encoder.encode('keyfolio:v1:recovery-auth:')
  const value = new Uint8Array(label.length + bytes.length)
  value.set(label)
  value.set(bytes, label.length)
  const proof = toBase64(
    new Uint8Array(await crypto.subtle.digest('SHA-256', value))
  )
  value.fill(0)
  bytes.fill(0)
  return proof
}
export async function createCredentials(
  username: string,
  master: string,
  existingRawKey?: Uint8Array<ArrayBuffer>
) {
  if (master.length < 12 || master.length > 256)
    throw new Error('主密码需要 12–256 个字符')
  const kdfSalt = randomBase64()
  const { wrappingKey, authProof } = await deriveMaster(master, kdfSalt)
  const rawKey = existingRawKey ?? crypto.getRandomValues(new Uint8Array(32))
  const recoveryKey = randomBase64()
  const recoveryAES = await aesKey(fromBase64(recoveryKey))
  const credentials: Credentials = {
    username,
    kdfSalt,
    authProof,
    wrappedKey: await encryptBytes(wrappingKey, rawKey, 'master-wrap'),
    recoveryWrappedKey: await encryptBytes(
      recoveryAES,
      rawKey,
      'recovery-wrap'
    ),
    recoveryProof: await recoveryProofFor(recoveryKey),
  }
  const key = await aesKey(rawKey)
  rawKey.fill(0)
  return { credentials, key, recoveryKey }
}
export async function unlockMaster(master: string, profile: PublicProfile) {
  const { wrappingKey, authProof } = await deriveMaster(master, profile.kdfSalt)
  const rawKey = await decryptBytes(
    wrappingKey,
    profile.wrappedKey,
    'master-wrap'
  )
  const key = await aesKey(rawKey)
  rawKey.fill(0)
  return { key, authProof }
}
export async function rewrapWithMaster(
  master: string,
  newMaster: string,
  profile: PublicProfile
) {
  const { wrappingKey, authProof } = await deriveMaster(master, profile.kdfSalt)
  const rawKey = await decryptBytes(
    wrappingKey,
    profile.wrappedKey,
    'master-wrap'
  )
  return {
    ...(await createCredentials(profile.username, newMaster, rawKey)),
    currentProof: authProof,
  }
}
export async function recoverCredentials(
  recoveryKey: string,
  master: string,
  profile: Pick<LoginProfile, 'username' | 'recoveryWrappedKey'>
) {
  const recoveryAES = await aesKey(fromBase64(recoveryKey.trim()))
  const rawKey = await decryptBytes(
    recoveryAES,
    profile.recoveryWrappedKey,
    'recovery-wrap'
  )
  return {
    ...(await createCredentials(profile.username, master, rawKey)),
    currentRecoveryProof: await recoveryProofFor(recoveryKey),
  }
}
export async function readBackup(
  text: string,
  secret: string,
  useRecovery: boolean
): Promise<VaultData> {
  const backup: BackupFile = backupSchema.parse(JSON.parse(text))
  let key: CryptoKey
  if (useRecovery) {
    const raw = await decryptBytes(
      await aesKey(fromBase64(secret.trim())),
      backup.profile.recoveryWrappedKey,
      'recovery-wrap'
    )
    key = await aesKey(raw)
    raw.fill(0)
  } else key = (await unlockMaster(secret, backup.profile)).key
  return decryptVault(key, backup.payload)
}
export async function makeBackup(
  data: VaultData,
  key: CryptoKey,
  profile: PublicProfile
): Promise<BackupFile> {
  return {
    format: 'keyfolio-encrypted-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile,
    payload: await encryptVault(key, data),
  }
}
export function generatePassword(length = 24) {
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+-_='
  let result = ''
  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2))
    for (const n of bytes) {
      if (n < Math.floor(256 / alphabet.length) * alphabet.length)
        result += alphabet[n % alphabet.length]
      if (result.length === length) break
    }
  }
  return result
}
