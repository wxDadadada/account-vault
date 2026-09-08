import { type Account } from './model'

export const accountTemplates = [
  {
    name: '云平台',
    category: '云服务',
    fields: ['账号 ID', '地域', 'Access Key ID', 'Access Key Secret'],
  },
  { name: '邮箱', category: '效率工具', fields: ['恢复邮箱', '应用专用密码'] },
  {
    name: '开发工具',
    category: '开发工具',
    fields: ['组织 / 项目', 'API Token'],
  },
]
export function applyTemplate(account: Account, name: string): Account {
  const template = accountTemplates.find((t) => t.name === name)
  if (!template) return account
  const existing = account.customFields ?? []
  return {
    ...account,
    category:
      account.category === '其他' ? template.category : account.category,
    customFields: [
      ...existing,
      ...template.fields
        .filter((label) => !existing.some((f) => f.label === label))
        .map((label) => ({
          id: crypto.randomUUID(),
          label,
          value: '',
          secret: /Secret|密码|Token/.test(label),
        })),
    ].slice(0, 30),
  }
}
