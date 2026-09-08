import { useMemo, useState } from 'react'
import { RotateCcw, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  accountIssues,
  issueNames,
  purgeDeleted,
  restoreDeleted,
  trashEntries,
} from '../lib/collection'
import { type Account } from '../lib/model'
import { useVault } from '../state/context'
import { Confirm, type Confirmation } from './Confirm'
import { FieldOption, FieldSelect } from './controls'
import { EmptyState, PlatformIcon } from './ui'

export function CollectionTools({
  mode,
  onClose,
  onSelect,
}: {
  mode: 'health' | 'trash'
  onClose: () => void
  onSelect: (a: Account) => void
}) {
  const { data, commit, busy } = useVault()
  const [query, setQuery] = useState('')
  const [issue, setIssue] = useState('all')
  const [selected, setSelected] = useState<string[]>([])
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const issues = useMemo(() => accountIssues(data!.accounts), [data])
  const trash = trashEntries(data!)
  const rows = (
    mode === 'trash'
      ? trash.map((t) => t.account)
      : data!.accounts.filter((a) =>
          issues.get(a.id)?.some((i) => issue === 'all' || i.type === issue)
        )
  ).filter((a) =>
    (a.platform + ' ' + (a.alias ?? '') + ' ' + a.username)
      .toLowerCase()
      .includes(query.toLowerCase())
  )
  const chosen = rows.filter((a) => selected.includes(a.id))
  function act(accounts: Account[], purge = false) {
    setConfirmation({
      title: purge
        ? `彻底删除 ${accounts.length} 个账号及其历史？`
        : `恢复 ${accounts.length} 个账号？`,
      description: purge
        ? '当前账号库中的密码、自定义字段、验证码密钥和变更记录会一起清除，此操作无法通过回收站撤销。已有备份中的副本不受影响。'
        : '账号将返回账号库并生成恢复记录。出现重复账号时会停止整批恢复，保留回收站内容。',
      label: purge ? '彻底删除' : '确认恢复',
      danger: purge,
      action: async () => {
        await commit((d) =>
          purge ? purgeDeleted(d, accounts) : restoreDeleted(d, accounts)
        )
        setSelected([])
        toast.success(purge ? '已彻底删除所选账号及历史' : '账号已恢复')
      },
    })
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className='vault-dialog collection-tools-dialog'>
        <DialogHeader>
          <DialogTitle>{mode === 'health' ? '账号检查' : '回收站'}</DialogTitle>
          <DialogDescription>
            {mode === 'health'
              ? '在本机检查使用中的账号，并给出可以处理的问题。'
              : '删除的账号和历史保留在这里，可以单独或批量恢复。'}
          </DialogDescription>
        </DialogHeader>
        {mode === 'health' && (
          <p className='inline-note'>
            <ShieldCheck size={16} />
            检查密码长度、常见模式、重复使用和资料完整性。这是本地规则检查，未查询外部泄漏库；已停用账号不参与检查。
          </p>
        )}
        <div className='tool-search'>
          <div className='search-field'>
            <Search size={17} />
            <Input
              aria-label={mode === 'health' ? '搜索检查结果' : '搜索回收站'}
              placeholder='搜索平台、别名或账号'
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelected([])
              }}
            />
          </div>
          {mode === 'health' && (
            <FieldSelect
              aria-label='检查类型'
              value={issue}
              onValueChange={setIssue}
            >
              <FieldOption value='all'>全部问题</FieldOption>
              {Object.entries(issueNames).map(([v, label]) => (
                <FieldOption key={v} value={v}>
                  {label}
                </FieldOption>
              ))}
            </FieldSelect>
          )}
        </div>
        {mode === 'trash' && rows.length > 0 && (
          <div className='trash-toolbar'>
            <label className='select-results'>
              <Checkbox
                aria-label='选择回收站全部结果'
                checked={
                  chosen.length === rows.length
                    ? true
                    : chosen.length
                      ? 'indeterminate'
                      : false
                }
                onCheckedChange={(v) =>
                  setSelected(v ? rows.map((a) => a.id) : [])
                }
              />
              已选 {chosen.length} 个
            </label>
            <Button
              size='sm'
              variant='outline'
              disabled={busy || !chosen.length}
              onClick={() => act(chosen)}
            >
              <RotateCcw size={14} />
              批量恢复
            </Button>
            <Button
              size='sm'
              variant='ghost'
              disabled={busy || !chosen.length}
              onClick={() => act(chosen, true)}
            >
              彻底删除所选
            </Button>
          </div>
        )}
        <div
          className='tool-result-list'
          aria-label={mode === 'health' ? '检查结果' : '已删除的账号'}
        >
          {rows.map((account) => (
            <article className='tool-account-row' key={account.id}>
              {mode === 'trash' && (
                <Checkbox
                  aria-label={
                    '选择已删除账号 ' +
                    account.platform +
                    ' ' +
                    account.username
                  }
                  checked={chosen.some((a) => a.id === account.id)}
                  onCheckedChange={(v) =>
                    setSelected((ids) =>
                      v
                        ? [...ids, account.id]
                        : ids.filter((id) => id !== account.id)
                    )
                  }
                />
              )}
              <PlatformIcon account={account} small />
              <div className='tool-account-info'>
                <strong>{account.alias || account.platform}</strong>
                <span>{account.username}</span>
                {mode === 'health' ? (
                  <ul>
                    {issues
                      .get(account.id)
                      ?.filter((i) => issue === 'all' || i.type === issue)
                      .map((i) => (
                        <li key={i.type}>
                          <b>{issueNames[i.type]}</b>：{i.reason}
                        </li>
                      ))}
                  </ul>
                ) : (
                  <small>
                    {data!.subjects.find((s) => s.id === account.subjectId)
                      ?.name || '未分配主体'}{' '}
                    · 删除于{' '}
                    {new Date(
                      trash.find((t) => t.account.id === account.id)!.deletedAt
                    ).toLocaleString('zh-CN')}
                  </small>
                )}
              </div>
              <div className='tool-account-actions'>
                {mode === 'health' ? (
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => onSelect(account)}
                  >
                    查看并处理
                  </Button>
                ) : (
                  <>
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={busy}
                      onClick={() => act([account])}
                    >
                      恢复
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      disabled={busy}
                      aria-label={'彻底删除 ' + account.platform}
                      onClick={() => act([account], true)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
        {!rows.length && (
          <EmptyState
            title={
              query || issue !== 'all'
                ? '没有匹配的结果'
                : mode === 'health'
                  ? '本地检查未发现待处理问题'
                  : '回收站是空的'
            }
            text={
              query || issue !== 'all'
                ? '试试其他关键词或检查类型。'
                : mode === 'health'
                  ? '新增账号或更新信息后会重新检查。'
                  : '移入回收站的账号会出现在这里。'
            }
          />
        )}
        {confirmation && (
          <Confirm value={confirmation} onClose={() => setConfirmation(null)} />
        )}
      </DialogContent>
    </Dialog>
  )
}
