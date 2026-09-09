import { useState } from 'react'
import {
  ArrowDown,
  Eye,
  EyeOff,
  History as HistoryIcon,
  RotateCcw,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldSelect, FieldOption } from '../components/controls'
import { EmptyState, PageHeading } from '../components/ui'
import {
  type Account,
  type Change,
  displayDate,
  fieldNames,
  statusNames,
} from '../lib/model'
import { useVault } from '../state/context'

export function ChangeDiff({
  change,
  onRestore,
}: {
  change: Change
  onRestore: () => void
}) {
  const { data } = useVault()
  const [reveal, setReveal] = useState(false)
  const fields = change.fields.length
    ? change.fields
    : ['platform', 'username', 'subjectId']
  function value(account: Account | null, key: string) {
    if (!account) return '—'
    const v = account[key as keyof Account]
    if (key === 'password' || key === 'totp')
      return v ? (reveal ? String(v) : '••••••••') : '未填写'
    if (key === 'customFields')
      return (
        (account.customFields ?? [])
          .map(
            (field) =>
              `${field.label}：${field.secret && !reveal && field.value ? '••••••••' : field.value || '未填写'}`
          )
          .join('\n') || '未填写'
      )
    if (key === 'reminderDays') return `${account.reminderDays ?? 7} 天`
    if (key === 'subjectId')
      return data?.subjects.find((s) => s.id === v)?.name ?? '未分配主体'
    if (key === 'status') return statusNames[account.status]
    if (key === 'favorite') return v ? '已收藏' : '未收藏'
    return Array.isArray(v) ? v.join('、') || '—' : String(v || '—')
  }
  return (
    <div className='change-diff'>
      {fields.map((f) => (
        <div className='diff-row' key={f}>
          <span>{fieldNames[f] ?? f}</span>
          <div>
            <del>{value(change.before, f)}</del>
            <ArrowDown size={12} />
            <ins>{value(change.after, f)}</ins>
          </div>
        </div>
      ))}
      <div className='diff-actions'>
        {fields.some((f) =>
          ['password', 'totp', 'customFields'].includes(f)
        ) && (
          <Button
            size='sm'
            variant='ghost'
            onClick={() => {
              setReveal(!reveal)
              if (!reveal) setTimeout(() => setReveal(false), 30000)
            }}
          >
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
            {reveal
              ? '隐藏敏感内容'
              : fields.includes('password')
                ? '查看密码值'
                : '查看敏感内容'}
          </Button>
        )}
        <Button size='sm' variant='outline' onClick={onRestore}>
          <RotateCcw size={15} /> 恢复此记录
        </Button>
      </div>
    </div>
  )
}
export function HistoryPage({
  onRestore,
}: {
  onRestore: (change: Change) => void
}) {
  const { data } = useVault()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  if (!data) return null
  const changes = data.changes.filter(
    (c) =>
      `${c.platform} ${c.after?.username ?? c.before?.username ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === 'all' || c.action === filter)
  )
  const names = {
    create: '新增账号',
    update: '更新账号',
    delete: '删除账号',
    restore: '恢复版本',
  }
  return (
    <>
      <PageHeading title='变更记录' subtitle='每一次变化，都在这里。' />
      <div className='search-toolbar'>
        <div className='search-field'>
          <Search size={19} />
          <Input
            placeholder='搜索平台或账号…'
            aria-label='搜索变更记录'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <FieldSelect
          aria-label='筛选变更类型'
          value={filter}
          onValueChange={(selectedValue) => setFilter(selectedValue)}
        >
          <FieldOption value='all'>全部变更</FieldOption>
          {Object.entries(names).map(([value, name]) => (
            <FieldOption key={value} value={value}>
              {name}
            </FieldOption>
          ))}
        </FieldSelect>
      </div>
      <div className='results-caption'>
        <span>{changes.length} 条变更</span>
        <span>每个账号保留最近 {data.preferences.historyLimit} 条</span>
      </div>
      {changes.length ? (
        <div className='timeline-panel'>
          {changes.map((c) => (
            <div className='timeline-item' key={c.id}>
              <Button
                variant='ghost'
                type='button'
                className='timeline-row'
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                aria-expanded={expanded === c.id}
              >
                <span className={`timeline-mark ${c.action}`}>
                  <HistoryIcon size={18} />
                </span>
                <div>
                  <h2>
                    {c.platform}
                    <span>{names[c.action]}</span>
                  </h2>
                  <p>
                    {c.source === 'ai'
                      ? 'AI 录入'
                      : c.source === 'import'
                        ? '备份导入'
                        : '手动修改'}
                    <span className='separator-dot'>·</span>
                    {displayDate(c.at, true)}
                  </p>
                </div>
                <span className='history-field-count'>
                  {c.action === 'update'
                    ? `${c.fields.length} 项变更`
                    : '查看详情'}
                </span>
              </Button>
              {expanded === c.id && (
                <ChangeDiff change={c} onRestore={() => onRestore(c)} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title='这里会记录每一次变化'
          text='新增、修改或删除账号后，变更记录会自动出现。'
        />
      )}
    </>
  )
}
