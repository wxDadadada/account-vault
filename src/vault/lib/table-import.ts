import { duplicateAccount, saveAccount, saveSubject } from './domain'
import { blankAccount, type Account, type VaultData } from './model'
import { subjectLabel } from './subject-identity'
import { accountSchema } from './validation'

export const importFields = {
  platform: '平台',
  username: '账号',
  password: '密码',
  alias: '账号别名',
  subject: '所属主体',
  category: '分类',
  tags: '标签',
  url: '登录地址',
  email: '绑定邮箱',
  phone: '绑定手机',
  notes: '备注',
  status: '状态',
  loginMethod: '登录方式',
  expiresOn: '到期日期',
  totp: '验证码密钥',
}
export type ImportField = keyof typeof importFields
export type ColumnMapping = Partial<Record<ImportField, number>>
export type ImportRow = {
  line: number
  account?: Account
  existing?: Account
  subjectName: string
  error?: string
  action: 'add' | 'update' | 'skip' | 'error'
}

export function parseTable(text: string) {
  if (text.length > 2_000_000) throw new Error('文件或表格内容不能超过 2 MB')
  text = text.replace(/^\uFEFF/, '')
  // Pick a delimiter only from the unquoted header, not from cell contents.
  let quoted = false
  let comma = 0
  let tab = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') i++
      else quoted = !quoted
    } else if (!quoted) {
      if (text[i] === '\n' || text[i] === '\r') break
      if (text[i] === ',') comma++
      if (text[i] === '\t') tab++
    }
  }
  const delimiter = tab > comma ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let closedQuote = false
  function cell() {
    row.push(field)
    field = ''
    closedQuote = false
    if (row.length > 60) throw new Error('表格最多支持 60 列')
  }
  function finishRow() {
    cell()
    if (row.some((v) => v.trim())) rows.push(row)
    row = []
    if (rows.length > 1001)
      throw new Error('每次最多导入 1000 个账号，请分批导入')
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
          closedQuote = true
        }
      } else field += char
    } else if (char === delimiter) cell()
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      finishRow()
    } else if (char === '"' && !field && !closedQuote) inQuotes = true
    else {
      if (closedQuote || char === '"')
        throw new Error('引号格式不正确，请使用标准 CSV 或从表格重新复制')
      field += char
    }
  }
  if (inQuotes) throw new Error('表格中有未闭合的引号')
  if (field || row.length || closedQuote) finishRow()
  if (rows.length < 2) throw new Error('需要一行列名和至少一行账号数据')
  if (rows.some((r) => r.length !== rows[0].length))
    throw new Error('表格列数不一致，请检查分隔符或引号')
  return { headers: rows[0], rows: rows.slice(1) }
}
export function suggestMapping(headers: string[]): ColumnMapping {
  const aliases: Record<ImportField, string[]> = {
    platform: ['平台', '平台名称', 'name', 'title', 'platform'],
    username: ['账号', '用户名', 'username', 'login_username', 'account'],
    password: ['密码', 'password', 'login_password'],
    alias: ['账号别名', '别名', 'alias'],
    subject: ['所属主体', '主体', 'subject'],
    category: ['分类', 'category', 'folder'],
    tags: ['标签', 'tags'],
    url: ['网址', '登录地址', 'url', 'login_uri', 'website'],
    email: ['绑定邮箱', 'email'],
    phone: ['绑定手机', 'phone'],
    notes: ['备注', 'notes', 'note'],
    status: ['状态', 'status'],
    loginMethod: ['登录方式', 'loginmethod'],
    expiresOn: ['到期日期', 'expireson'],
    totp: ['验证码密钥', 'totp', 'login_totp'],
  }
  return Object.fromEntries(
    Object.entries(aliases)
      .map(([key, names]) => [
        key,
        headers.findIndex((h) => names.includes(h.trim().toLowerCase())),
      ])
      .filter(([, index]) => Number(index) >= 0)
  )
}

export function previewImport(
  data: VaultData,
  rows: string[][],
  mapping: ColumnMapping,
  policy: 'skip' | 'update',
  defaultSubject: string
): ImportRow[] {
  if (mapping.platform === undefined || mapping.username === undefined)
    throw new Error('请先对应平台和账号列')
  const chosen = Object.values(mapping)
  if (new Set(chosen).size !== chosen.length)
    throw new Error('同一列不能对应多个字段')
  const seen = new Set<string>()
  return rows.map((cells, index) => {
    const get = (key: ImportField) =>
      mapping[key] === undefined ? '' : (cells[mapping[key]!] ?? '')
    const subjectName = get('subject').trim()
    try {
      const matches = subjectName
        ? data.subjects.filter((s) =>
            [s.name, ...s.aliases].some(
              (n) => subjectLabel(n) === subjectLabel(subjectName)
            )
          )
        : []
      if (matches.length > 1) throw new Error('主体名称有歧义，请先整理主体')
      const subjectId = subjectName
        ? (matches[0]?.id ?? `import:${subjectLabel(subjectName)}`)
        : defaultSubject
      let account: Account = {
        ...blankAccount(subjectId),
        platform: get('platform').trim(),
        username: get('username').trim(),
      }
      for (const key of [
        'password',
        'alias',
        'url',
        'email',
        'phone',
        'notes',
        'totp',
        'expiresOn',
      ] as const)
        if (mapping[key] !== undefined)
          account[key] =
            key === 'password' || key === 'notes' ? get(key) : get(key).trim()
      if (get('category').trim()) account.category = get('category').trim()
      if (mapping.tags !== undefined)
        account.tags = [
          ...new Set(
            get('tags')
              .split(/[,，;；]/)
              .map((t) => t.trim())
              .filter(Boolean)
          ),
        ]
      if (get('loginMethod').trim())
        account.loginMethod = get('loginMethod').trim()
      if (get('status').trim()) {
        const names: Record<string, Account['status']> = {
          active: 'active',
          inactive: 'inactive',
          pending: 'pending',
          使用中: 'active',
          已停用: 'inactive',
          待完善: 'pending',
        }
        const status = names[get('status').trim()]
        if (!status) throw new Error('状态应为使用中、已停用或待完善')
        account.status = status
      }
      // Validate a temporary subject id separately from user-facing names.
      const checked = accountSchema.safeParse({
        ...account,
        subjectId: matches[0]?.id ?? defaultSubject,
      })
      if (!checked.success)
        throw new Error(
          `请检查${importFields[checked.error.issues[0].path[0] as ImportField] ?? '字段'}：内容缺失、格式不正确或过长`
        )
      if (subjectName.length > 200)
        throw new Error('主体名称不能超过 200 个字符')
      const identity = JSON.stringify([
        subjectId,
        account.platform.toLowerCase(),
        account.username,
        account.url,
      ])
      if (seen.has(identity))
        throw new Error('表格内存在相同主体、平台、账号和登录地址的重复行')
      seen.add(identity)
      const existing = duplicateAccount(data, account)
      if (existing && policy === 'update') {
        const patch = { ...existing }
        for (const key of Object.keys(mapping) as ImportField[]) {
          if (key === 'subject') patch.subjectId = subjectId
          else Object.assign(patch, { [key]: account[key] })
        }
        account = patch
      }
      return {
        line: index + 2,
        account,
        existing,
        subjectName,
        action: existing ? policy : 'add',
      }
    } catch (e) {
      return {
        line: index + 2,
        subjectName,
        action: 'error',
        error: e instanceof Error ? e.message : '该行无法导入',
      }
    }
  })
}
export function applyImport(data: VaultData, preview: ImportRow[]) {
  if (preview.some((row) => row.error))
    throw new Error('请修正所有错误行后再导入')
  let next = structuredClone(data)
  const created = new Map<string, string>()
  for (const row of preview) {
    if (!row.account || row.action === 'skip') continue
    const account = { ...row.account }
    if (account.subjectId.startsWith('import:')) {
      const normalized = subjectLabel(row.subjectName)
      let id = created.get(normalized)
      if (!id) {
        const existing = next.subjects.filter((s) =>
          [s.name, ...s.aliases].some(
            (name) => subjectLabel(name) === normalized
          )
        )
        if (existing.length)
          throw new Error('主体列表已发生变化，请重新预览导入')
        id = crypto.randomUUID()
        created.set(normalized, id)
        next = saveSubject(next, {
          id,
          name: row.subjectName,
          aliases: [],
          type: 'company',
          color: 'blue',
        })
      }
      account.subjectId = id
    }
    next = saveAccount(next, account, 'import', row.existing ?? null)
  }
  return next
}
