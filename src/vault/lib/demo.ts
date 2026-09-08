import { emptyVault, type Account, type VaultData } from './model'

export function demoVault(): VaultData {
  const date = (days: number) =>
    new Date(Date.now() - days * 86400000).toISOString()
  const subjects: VaultData['subjects'] = [
    {
      id: 'personal',
      name: '我个人',
      type: 'personal',
      aliases: ['个人'],
      color: 'green',
    },
    {
      id: 'xinghe',
      name: '星河科技',
      type: 'company',
      aliases: ['星河科技有限公司'],
      color: 'blue',
    },
    {
      id: 'studio',
      name: '独立工作室',
      type: 'company',
      aliases: ['工作室'],
      color: 'purple',
    },
  ]
  const rows = [
    [
      'GitHub',
      'hello@example.com',
      'personal',
      '开发工具',
      '个人开发,代码托管',
      'https://github.com/login',
    ],
    [
      '阿里云',
      'ops@example.com',
      'xinghe',
      '云服务',
      '生产环境,商城项目',
      'https://account.aliyun.com',
    ],
    [
      'Figma',
      'design@example.com',
      'studio',
      '效率工具',
      '设计,团队协作',
      'https://www.figma.com/login',
    ],
    [
      '微信公众平台',
      'brand@example.com',
      'xinghe',
      '社交媒体',
      '品牌运营',
      'https://mp.weixin.qq.com',
    ],
    [
      'Notion',
      'hello@example.com',
      'personal',
      '效率工具',
      '知识库',
      'https://www.notion.so/login',
    ],
    [
      'Stripe',
      'finance@example.com',
      'studio',
      '支付金融',
      '海外业务',
      'https://dashboard.stripe.com/login',
    ],
    [
      '腾讯云',
      'dev@example.com',
      'xinghe',
      '云服务',
      '测试环境',
      'https://cloud.tencent.com/login',
    ],
    [
      '小红书',
      'creator@example.com',
      'personal',
      '社交媒体',
      '内容创作',
      'https://www.xiaohongshu.com',
    ],
  ]
  const accounts: Account[] = rows.map((r, i) => ({
    id: `demo-${i}`,
    platform: r[0],
    username: r[1],
    subjectId: r[2],
    category: r[3],
    tags: r[4].split(','),
    url: r[5],
    password: 'Demo-only-DoNotUse!23',
    email: r[1],
    phone: '',
    loginMethod: '密码登录',
    status: i === 6 ? 'pending' : 'active',
    notes: i === 1 ? '商城正式环境。服务器和域名均在此账号下管理。' : '',
    favorite: i < 3,
    createdAt: date(30 + i),
    updatedAt: date(i),
  }))
  return {
    ...emptyVault(),
    subjects,
    accounts,
    changes: accounts.slice(0, 5).map((a, i) => ({
      id: `change-${i}`,
      accountId: a.id,
      platform: a.platform,
      action: i ? 'create' : 'update',
      at: a.updatedAt,
      source: i === 1 ? 'ai' : 'manual',
      fields: i ? ['platform', 'username'] : ['password'],
      before: i ? null : { ...a, password: 'Demo-old-value' },
      after: a,
    })),
  }
}
