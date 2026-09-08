import { type CaptureItem, type SearchPlan } from '../../../shared/protocol'
import { type Account, type Subject, type VaultData } from './model'
import { subjectLabel, subjectLabels } from './subject-identity'

const catalog = [
  { name: '阿里云', aliases: ['阿里云', 'aliyun'], category: '云服务' },
  { name: '腾讯云', aliases: ['腾讯云'], category: '云服务' },
  { name: 'GitHub', aliases: ['github'], category: '开发工具' },
  { name: 'GitLab', aliases: ['gitlab'], category: '开发工具' },
  {
    name: '微信公众平台',
    aliases: ['微信公众平台', '微信公众号', '公众号'],
    category: '社交媒体',
  },
  { name: '微信支付', aliases: ['微信支付'], category: '支付金融' },
  { name: '支付宝', aliases: ['支付宝', 'alipay'], category: '支付金融' },
  { name: '抖音', aliases: ['抖音'], category: '社交媒体' },
  { name: '小红书', aliases: ['小红书'], category: '社交媒体' },
  { name: 'Figma', aliases: ['figma'], category: '效率工具' },
  { name: 'Notion', aliases: ['notion'], category: '效率工具' },
  { name: '飞书', aliases: ['飞书', 'lark'], category: '效率工具' },
  { name: 'Stripe', aliases: ['stripe'], category: '支付金融' },
  { name: 'Cloudflare', aliases: ['cloudflare'], category: '云服务' },
  { name: '淘宝', aliases: ['淘宝'], category: '电商平台' },
]
export function findSubject(name: string | undefined, subjects: Subject[]) {
  if (!name) return undefined
  const normalized = subjectLabel(name)
  const matches = subjects.filter((s) => subjectLabels(s).has(normalized))
  // Legacy vaults remain readable, but an ambiguous label must never select a row.
  return matches.length === 1 ? matches[0] : undefined
}
export function canonicalPlatform(value: string) {
  return (
    catalog
      .find((p) => p.aliases.includes(value.trim().toLowerCase()))
      ?.name.toLowerCase() ?? value.trim().toLowerCase()
  )
}
export function platformSearchTerms(value: string) {
  const canonical = canonicalPlatform(value)
  return [
    value,
    ...(catalog.find((p) => p.name.toLowerCase() === canonical)?.aliases ?? []),
  ].join(' ')
}
function mentionedSubject(text: string, data: VaultData) {
  const match = data.subjects
    .flatMap((s) => [...subjectLabels(s)].map((alias) => ({ alias })))
    .sort((a, b) => b.alias.length - a.alias.length)
    .find((v) => text.toLowerCase().includes(subjectLabel(v.alias)))
  return match ? findSubject(match.alias, data.subjects)?.name : undefined
}
export function parseLocalCapture(
  text: string,
  data: VaultData
): CaptureItem[] {
  const lines = text
    .split(/[\n；;]/)
    .map((s) => s.trim())
    .filter(Boolean)
  return lines.slice(0, 20).map((line) => {
    const lower = line.toLowerCase()
    const known = [
      ...catalog,
      ...data.accounts.map((a) => ({
        name: a.platform,
        aliases: [a.platform.toLowerCase()],
        category: a.category,
      })),
    ]
      .sort((a, b) => b.name.length - a.name.length)
      .find((p) => p.aliases.some((alias) => lower.includes(alias)))
    const platform =
      known?.name ??
      line.match(/平台\s*[:：=是为]?\s*[「“"']?([^，,。\s」”"']+)/)?.[1] ??
      line.match(/(?:在|注册了?)\s*([^，,。\s]+?)(?:的?账号|平台)/)?.[1] ??
      ''
    const username =
      line.match(
        /(?:账号|用户名|登录名)\s*(?:是|为|[:：=])\s*[「“"']?([^，,。\s」”"']+)/
      )?.[1] ?? line.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/)?.[0]
    const subjectPrefix = known
      ? line
          .slice(
            0,
            lower.indexOf(known.aliases.find((alias) => lower.includes(alias))!)
          )
          .match(/([^，,。\s]+)的\s*$/)?.[1]
      : undefined
    const subject =
      mentionedSubject(line, data) ??
      subjectPrefix ??
      line.match(/(?:主体|归属|属于)\s*(?:是|为|[:：=])?\s*([^，,。\s]+)/)?.[1]
    const category =
      data.categories.find((c) => line.includes(c)) ?? known?.category
    const tagString = line.match(
      /标签(?:加上|添加|是|为|[:：=])?\s*([^。]+)/
    )?.[1]
    const tags = tagString
      ?.split(/[,，、\s]/)
      .filter(Boolean)
      .slice(0, 20)
    const email = line.match(
      /(?:绑定邮箱|邮箱)(?:换成|改为|改成|是|为|[:：=])?\s*([\w.+-]+@[\w.-]+\.[a-zA-Z]{2,})/
    )?.[1]
    const phone = line
      .match(
        /(?:绑定手机|手机号|手机)(?:换成|改为|改成|是|为|[:：=])?\s*([+\d -]{5,20})/
      )?.[1]
      ?.trim()
    const url = line.match(/https?:\/\/[^\s，,。]+/)?.[0]
    const notes = line.match(
      /(?:备注|用于|用来)\s*(?:是|为|[:：=])?\s*([^，,。]+)/
    )?.[1]
    return {
      action: /更新|修改|换绑|换成|改为|改成|停用/.test(line)
        ? 'update'
        : 'create',
      platform,
      ...(username ? { username } : {}),
      ...(subject ? { subject } : {}),
      ...(category ? { category } : {}),
      ...(tags ? { tags } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(url ? { url } : {}),
      ...(notes ? { notes } : {}),
      ...(/停用/.test(line) ? { status: 'inactive' as const } : {}),
    }
  })
}
export function parseLocalSearch(
  text: string,
  data: VaultData,
  now = new Date()
): SearchPlan {
  const plan: SearchPlan = { keywords: [] }
  const subject = mentionedSubject(text, data)
  if (subject) plan.subject = subject
  const category = data.categories.find((c) => text.includes(c))
  if (category) plan.category = category
  for (const platform of new Set(data.accounts.map((a) => a.platform)))
    if (
      platformSearchTerms(platform)
        .toLowerCase()
        .split(' ')
        .some((term) => text.toLowerCase().includes(term))
    )
      plan.keywords.push(platform)
  const phoneOrEmail = text.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}|\d{4,}/g)
  if (phoneOrEmail) plan.keywords.push(...phoneOrEmail)
  for (const tag of new Set(data.accounts.flatMap((a) => a.tags)))
    if (text.includes(tag)) plan.keywords.push(tag)
  if (/收藏/.test(text)) plan.favorite = true
  if (/停用/.test(text)) plan.status = 'inactive'
  if (/待完善/.test(text)) plan.status = 'pending'
  if (/(?:修改|更换|更新|改过|变更|换绑)/.test(text)) {
    if (/密码/.test(text)) plan.changedField = 'password'
    else if (/邮箱/.test(text)) plan.changedField = 'email'
    else if (/手机/.test(text)) plan.changedField = 'phone'
    else if (/主体/.test(text)) plan.changedField = 'subjectId'
  }
  const cn = new Date(now.getTime() + 8 * 3600000)
  const year = cn.getUTCFullYear(),
    month = cn.getUTCMonth()
  if (/上个月|上月/.test(text)) {
    plan.updatedAfter = new Date(Date.UTC(year, month - 1, 1, -8)).toISOString()
    plan.updatedBefore = new Date(Date.UTC(year, month, 1, -8)).toISOString()
  } else if (/这个月|本月/.test(text))
    plan.updatedAfter = new Date(Date.UTC(year, month, 1, -8)).toISOString()
  else if (/最近|近/.test(text)) {
    const days = Number(text.match(/(?:最近|近)\s*(\d+)\s*天/)?.[1] ?? 7)
    plan.updatedAfter = new Date(
      now.getTime() - Math.min(days, 36500) * 86400000
    ).toISOString()
  }
  if (
    !plan.keywords.length &&
    !plan.subject &&
    !plan.category &&
    plan.favorite === undefined &&
    !plan.status &&
    !plan.changedField &&
    !plan.updatedAfter
  )
    plan.keywords = [
      text
        .replace(
          /帮我|查找|查询|找出|找一下|搜索|账号|所有|有哪些|我的|一下/g,
          ''
        )
        .replace(/[？?。]/g, '')
        .trim(),
    ].filter(Boolean)
  return plan
}
export function executeSearch(plan: SearchPlan, data: VaultData): Account[] {
  const subject = findSubject(plan.subject, data.subjects)
  if (plan.subject && !subject) return []
  const within = (date: string) =>
    (!plan.updatedAfter || Date.parse(date) >= Date.parse(plan.updatedAfter)) &&
    (!plan.updatedBefore || Date.parse(date) < Date.parse(plan.updatedBefore))
  return data.accounts.filter((a) => {
    const owner = data.subjects.find((s) => s.id === a.subjectId)
    const haystack =
      `${platformSearchTerms(a.platform)} ${a.alias ?? ''} ${a.username} ${a.email} ${a.phone} ${a.category} ${a.tags.join(' ')} ${a.notes} ${owner?.name} ${owner?.aliases.join(' ')}`.toLowerCase()
    return (
      (!subject || a.subjectId === subject.id) &&
      (!plan.category || a.category === plan.category) &&
      (plan.favorite === undefined || a.favorite === plan.favorite) &&
      (!plan.status || a.status === plan.status) &&
      plan.keywords.every((k) => haystack.includes(k.toLowerCase())) &&
      (plan.changedField
        ? data.changes.some(
            (c) =>
              c.accountId === a.id &&
              c.action !== 'create' &&
              c.fields.includes(plan.changedField!) &&
              within(c.at)
          )
        : within(a.updatedAt))
    )
  })
}
