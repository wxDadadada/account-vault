export type Account = {
  id: string
  platform: string
  username: string
  password: string
  url: string
  subjectId: string
  category: string
  tags: string[]
  email: string
  phone: string
  loginMethod: string
  status: 'active' | 'inactive' | 'pending'
  notes: string
  favorite: boolean
  alias?: string
  customFields?: { id: string; label: string; value: string; secret: boolean }[]
  expiresOn?: string
  reminderDays?: number
  totp?: string
  createdAt: string
  updatedAt: string
}
export type CollectionFilter = {
  subject: string
  category: string
  status: 'all' | Account['status']
  favorite: boolean
  tags: string[]
  issue: 'all' | 'missing' | 'weak' | 'reused' | 'due'
  query: string
}
export type SavedView = { id: string; name: string; filter: CollectionFilter }
export type Subject = {
  id: string
  name: string
  type: 'personal' | 'company'
  aliases: string[]
  color: string
}
export type Change = {
  id: string
  accountId: string
  platform: string
  action: 'create' | 'update' | 'delete' | 'restore'
  at: string
  source: 'manual' | 'ai' | 'import'
  fields: string[]
  before: Account | null
  after: Account | null
}
export type AIConfig = { baseUrl: string; model: string; apiKey: string }
export type VaultData = {
  schemaVersion: 1
  accounts: Account[]
  subjects: Subject[]
  categories: string[]
  changes: Change[]
  savedViews?: SavedView[]
  ai: AIConfig
  preferences: { autoLockMinutes: number; historyLimit: number }
}
export const categories = [
  '云服务',
  '开发工具',
  '支付金融',
  '社交媒体',
  '电商平台',
  '效率工具',
  '其他',
]
export const emptyVault = (): VaultData => ({
  schemaVersion: 1,
  accounts: [],
  subjects: [
    {
      id: crypto.randomUUID(),
      name: '我个人',
      type: 'personal',
      aliases: [],
      color: 'green',
    },
  ],
  categories: [...categories],
  changes: [],
  ai: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKey: '',
  },
  preferences: { autoLockMinutes: 10, historyLimit: 20 },
})
export const fieldNames: Record<string, string> = {
  platform: '平台',
  username: '账号',
  password: '密码',
  url: '登录地址',
  subjectId: '所属主体',
  category: '分类',
  tags: '标签',
  email: '邮箱',
  phone: '手机',
  loginMethod: '登录方式',
  status: '状态',
  notes: '备注',
  favorite: '收藏',
  alias: '账号别名',
  customFields: '自定义字段',
  expiresOn: '到期日期',
  reminderDays: '提前提醒',
  totp: '验证码密钥',
}
export function displayDate(value: string, withTime = false) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  })
}
export const statusNames = {
  active: '使用中',
  inactive: '已停用',
  pending: '待完善',
}

export function blankAccount(subjectId = ''): Account {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    platform: '',
    username: '',
    password: '',
    url: '',
    subjectId,
    category: '其他',
    tags: [],
    email: '',
    phone: '',
    loginMethod: '密码登录',
    status: 'active',
    notes: '',
    favorite: false,
    createdAt: now,
    updatedAt: now,
  }
}
