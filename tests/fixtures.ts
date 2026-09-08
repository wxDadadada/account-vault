import { emptyVault, type Account } from '../src/vault/lib/model'

export const master = 'correct horse personal vault 42!'
export const nextMaster = 'a different secure master phrase 84!'
export function fixtureAccount(subjectId = ''): Account {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    platform: '测试云平台',
    username: 'owner@example.invalid',
    password: 'PRIVATE_PASSWORD_SENTINEL_!9',
    url: 'https://example.invalid/login',
    subjectId,
    category: '云服务',
    tags: ['生产'],
    email: 'mail@example.invalid',
    phone: '13800001234',
    loginMethod: '密码登录',
    status: 'active',
    notes: 'PRIVATE_NOTE_SENTINEL_记录',
    favorite: true,
    createdAt: now,
    updatedAt: now,
  }
}
export function fixtureVault() {
  const data = emptyVault()
  data.accounts = [fixtureAccount(data.subjects[0].id)]
  return data
}
