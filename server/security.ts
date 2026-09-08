import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import * as OTPAuth from 'otpauth'

export const hashToken = (value: string) =>
  createHash('sha256').update(value).digest('hex')
const scryptBuffer = (value: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      value,
      salt,
      32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key))
    )
  )
export async function hashProof(value: string) {
  const salt = randomBytes(16)
  const key = await scryptBuffer(value, salt)
  return `${salt.toString('base64')}:${key.toString('base64')}`
}
export async function verifyProof(value: string, stored: string) {
  const [salt, hash] = stored.split(':')
  const expected = Buffer.from(hash, 'base64')
  const key = await scryptBuffer(value, Buffer.from(salt, 'base64'))
  return expected.length === key.length && timingSafeEqual(expected, key)
}
export function serverSealer(dataDir: string) {
  const path = join(dataDir, 'server.key')
  if (!existsSync(path))
    writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' })
  chmodSync(path, 0o600)
  const key = readFileSync(path)
  if (key.length !== 32)
    throw new Error('server.key 格式不正确，请从完整备份恢复')
  return {
    seal(value: string) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(Buffer.from('keyfolio:server:totp:v1'))
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
    },
    open(value: string) {
      const body = Buffer.from(value, 'base64')
      const cipher = createDecipheriv('aes-256-gcm', key, body.subarray(0, 12))
      cipher.setAAD(Buffer.from('keyfolio:server:totp:v1'))
      cipher.setAuthTag(body.subarray(12, 28))
      return Buffer.concat([
        cipher.update(body.subarray(28)),
        cipher.final(),
      ]).toString('utf8')
    },
  }
}
export function totp(secret: string, username: string) {
  return new OTPAuth.TOTP({
    issuer: '拾钥 Keyfolio',
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  })
}
export function verifyTotp(
  secret: string,
  code: string,
  lastStep: number,
  now = Date.now()
) {
  if (!/^\d{6}$/.test(code)) return null
  const delta = totp(secret, '').validate({
    token: code,
    timestamp: now,
    window: 1,
  })
  if (delta === null) return null
  const step = Math.floor(now / 30000) + delta
  return step > lastStep ? step : null
}
