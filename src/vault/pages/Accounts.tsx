import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownUp,
  ArrowUpRight,
  CalendarClock,
  CheckCheck,
  Grid2X2,
  History,
  LayoutList,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  CollectionOverview,
  QuickCapture,
} from '../components/CollectionOverview'
import { Confirm, type Confirmation } from '../components/Confirm'
import { FieldOption, FieldSelect } from '../components/controls'
import { TextField } from '../components/fields'
import { CopyButton, EmptyState, PlatformIcon } from '../components/ui'
import { useDisplayPreference } from '../hooks/use-display-preference'
import {
  accountIssues,
  bulkDelete,
  defaultFilter,
  expiryLabel,
  filterAccounts,
  issueNames,
  trashEntries,
} from '../lib/collection'
import {
  type Account,
  type CollectionFilter,
  type VaultData,
  displayDate,
  statusNames,
} from '../lib/model'
import { useVault } from '../state/context'

const BulkEditor = lazy(() =>
  import('../components/BulkEditor').then((m) => ({ default: m.BulkEditor }))
)
const TableImport = lazy(() =>
  import('../components/TableImport').then((m) => ({ default: m.TableImport }))
)
const CollectionTools = lazy(() =>
  import('../components/CollectionTools').then((m) => ({
    default: m.CollectionTools,
  }))
)

type AccountsProps = {
  data: VaultData
  subject: string
  setSubject: (id: string) => void
  onSelect: (account: Account) => void
  onEdit: (account: Account) => void
  onAdd: () => void
  onAI: (text?: string) => void
  onAISearch: () => void
  onFavorite: (account: Account) => void
  onHistory: () => void
  demo: boolean
  query: string
  setQuery: (value: string) => void
}
export function Accounts({
  data,
  subject,
  setSubject,
  onSelect,
  onEdit,
  onAdd,
  onAI,
  onAISearch,
  onFavorite,
  onHistory,
  demo,
  query,
  setQuery,
}: AccountsProps) {
  const { commit, busy } = useVault()
  const [criteria, setCriteria] = useState(defaultFilter)
  const filter = { ...criteria, subject, query }
  const [showFilters, setShowFilters] = useState(false)
  const [view, setView] = useDisplayPreference(
    'account-view',
    ['grid', 'list'] as const,
    'list'
  )
  const [density, setDensity] = useDisplayPreference(
    'account-density',
    ['comfortable', 'compact'] as const,
    'comfortable'
  )
  const [sort, setSort] = useDisplayPreference(
    'account-sort',
    ['recent', 'name', 'expiry'] as const,
    'recent'
  )
  const [selected, setSelected] = useState<string[]>([])
  const [bulk, setBulk] = useState<Account[] | null>(null)
  const [importing, setImporting] = useState(false)
  const [tool, setTool] = useState<'health' | 'trash' | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [savingView, setSavingView] = useState(false)
  const [viewName, setViewName] = useState('')
  const [viewError, setViewError] = useState('')
  const [captureText, setCaptureText] = useState('')
  const [now, setNow] = useState(() => new Date())
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === 'k' &&
        !document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        e.preventDefault()
        search.current?.focus()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
  const issues = useMemo(
    () => accountIssues(data.accounts, now),
    [data.accounts, now]
  )
  const filtered = filterAccounts(data, filter, issues).sort((a, b) =>
    sort === 'recent'
      ? b.updatedAt.localeCompare(a.updatedAt)
      : sort === 'expiry'
        ? (a.expiresOn || '9999').localeCompare(b.expiresOn || '9999')
        : (a.alias || a.platform).localeCompare(b.alias || b.platform, 'zh-CN')
  )
  const scope = filterAccounts(
    data,
    { ...filter, status: 'all', favorite: false },
    issues
  )
  const selectedAccounts = filtered.filter((a) => selected.includes(a.id))
  const hasAll =
    filtered.length > 0 && selectedAccounts.length === filtered.length
  const allTags = [...new Set(data.accounts.flatMap((a) => a.tags))].sort(
    (a, b) => a.localeCompare(b, 'zh-CN')
  )
  const owner = data.subjects.find((s) => s.id === subject)
  const warningCount = data.accounts.filter(
    (a) => issues.get(a.id)?.length
  ).length
  const dueCount = data.accounts.filter((a) =>
    issues.get(a.id)?.some((i) => i.type === 'due')
  ).length
  function patch(p: Partial<CollectionFilter>) {
    setCriteria((c) => ({ ...c, ...p }))
    setSelected([])
  }
  function reset() {
    setCriteria(defaultFilter())
    setSubject('all')
    setQuery('')
    setSelected([])
  }
  function applyView(next: CollectionFilter) {
    setCriteria(next)
    setSubject(next.subject)
    setQuery(next.query)
    setSelected([])
  }
  function askDelete(accounts: Account[]) {
    setConfirmation({
      title: `将 ${accounts.length} 个账号移入回收站？`,
      description:
        accounts
          .slice(0, 4)
          .map((a) => a.alias || a.platform)
          .join('、') + '。账号和变更记录保留，可在回收站恢复。',
      label: '移入回收站',
      danger: true,
      action: async () => {
        await commit((d) => bulkDelete(d, accounts))
        setSelected([])
        toast.success('账号已移入回收站')
      },
    })
  }
  async function saveView() {
    setViewError('')
    if (!viewName.trim()) {
      setViewError('请填写视图名称')
      return
    }
    try {
      await commit((d) => {
        if (
          (d.savedViews ?? []).some(
            (v) => v.name.toLowerCase() === viewName.trim().toLowerCase()
          )
        )
          throw new Error('已存在同名视图')
        return {
          ...d,
          savedViews: [
            ...(d.savedViews ?? []),
            { id: crypto.randomUUID(), name: viewName.trim(), filter },
          ],
        }
      })
      setSavingView(false)
      toast.success('筛选视图已加密保存')
    } catch (e) {
      setViewError(e instanceof Error ? e.message : '保存失败')
    }
  }
  const chips: { label: string; remove: () => void }[] = [
    ...(subject !== 'all'
      ? [
          {
            label:
              owner?.name || (subject === '' ? '未分配主体' : '主体已不可用'),
            remove: () => setSubject('all'),
          },
        ]
      : []),
    ...(criteria.category !== 'all'
      ? [{ label: criteria.category, remove: () => patch({ category: 'all' }) }]
      : []),
    ...(criteria.status !== 'all'
      ? [
          {
            label: statusNames[criteria.status],
            remove: () => patch({ status: 'all' }),
          },
        ]
      : []),
    ...(criteria.favorite
      ? [{ label: '已收藏', remove: () => patch({ favorite: false }) }]
      : []),
    ...(criteria.issue !== 'all'
      ? [
          {
            label: issueNames[criteria.issue],
            remove: () => patch({ issue: 'all' }),
          },
        ]
      : []),
    ...criteria.tags.map((tag) => ({
      label: tag,
      remove: () => patch({ tags: criteria.tags.filter((t) => t !== tag) }),
    })),
    ...(query ? [{ label: '搜索：' + query, remove: () => setQuery('') }] : []),
  ]
  return (
    <div className='collection-workbench'>
      <div className='workbench-heading'>
        <div>
          <h1>我的账号库</h1>
          <p>每一个数字身份，都在这里。</p>
        </div>
        <QuickCapture
          captureText={captureText}
          setCaptureText={setCaptureText}
          onCapture={() => {
            onAI(captureText)
            setCaptureText('')
          }}
        />
        <div className='workbench-heading-actions'>
          <Button variant='outline' onClick={() => setImporting(true)}>
            <Upload size={16} />
            导入账号
          </Button>
          <Button onClick={onAdd} className='primary-button desktop-add'>
            <Plus size={17} />
            添加账号
          </Button>
        </div>
      </div>
      <CollectionOverview
        data={data}
        subject={subject}
        setSubject={(id) => {
          setSubject(id)
          setSelected([])
        }}
        warnings={warningCount}
        onHealth={() => setTool('health')}
      />
      <div className='library-content'>
        {!!data.savedViews?.length && (
          <div className='saved-view-list' aria-label='已保存的筛选视图'>
            <span>常用视图</span>
            {data.savedViews.map((saved) => (
              <div key={saved.id} className='saved-view-chip'>
                <Button
                  variant='ghost'
                  aria-pressed={
                    JSON.stringify(filter) === JSON.stringify(saved.filter)
                  }
                  onClick={() => applyView(saved.filter)}
                >
                  {saved.name}
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label={'删除视图 ' + saved.name}
                  onClick={() =>
                    setConfirmation({
                      title: `删除「${saved.name}」视图？`,
                      description: '仅删除这组筛选条件，账号内容会保留。',
                      label: '删除视图',
                      action: () =>
                        commit((d) => ({
                          ...d,
                          savedViews: d.savedViews?.filter(
                            (v) => v.id !== saved.id
                          ),
                        })),
                    })
                  }
                >
                  <X size={13} />
                </Button>
              </div>
            ))}
          </div>
        )}
        <section className='collection-surface' aria-label='账号列表'>
          <div className='collection-commandbar'>
            <div
              className='collection-segments'
              role='group'
              aria-label='快速筛选'
            >
              <Button
                variant='ghost'
                aria-pressed={!criteria.favorite && criteria.status === 'all'}
                onClick={() => patch({ favorite: false, status: 'all' })}
              >
                全部账号 <span>{scope.length}</span>
              </Button>
              <Button
                variant='ghost'
                aria-pressed={criteria.favorite}
                onClick={() => patch({ favorite: !criteria.favorite })}
              >
                <Star size={14} />
                收藏 <span>{scope.filter((a) => a.favorite).length}</span>
              </Button>
              <Button
                variant='ghost'
                aria-pressed={criteria.status === 'pending'}
                onClick={() =>
                  patch({
                    status: criteria.status === 'pending' ? 'all' : 'pending',
                    favorite: false,
                  })
                }
              >
                待完善{' '}
                <span>
                  {scope.filter((a) => a.status === 'pending').length}
                </span>
              </Button>
            </div>
            <div className='collection-display'>
              <Button
                variant='ghost'
                size='icon'
                aria-label='卡片视图'
                aria-pressed={view === 'grid'}
                onClick={() => setView('grid')}
              >
                <Grid2X2 size={17} />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                aria-label='列表视图'
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
              >
                <LayoutList size={18} />
              </Button>
              <Button
                variant='ghost'
                className='density-toggle'
                aria-pressed={density === 'compact'}
                onClick={() =>
                  setDensity(density === 'compact' ? 'comfortable' : 'compact')
                }
              >
                {density === 'compact' ? '紧凑' : '舒适'}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='collection-tools-trigger'
                    aria-label='账号工具'
                  >
                    <MoreHorizontal size={19} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem onClick={() => setTool('health')}>
                    <ShieldCheck size={16} />
                    账号检查 <span className='menu-count'>{warningCount}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      reset()
                      patch({ issue: 'due' })
                    }}
                  >
                    <CalendarClock size={16} />
                    到期提醒 <span className='menu-count'>{dueCount}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTool('trash')}>
                    <Trash2 size={16} />
                    回收站{' '}
                    <span className='menu-count'>
                      {trashEntries(data).length}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onHistory}>
                    <History size={16} />
                    变更记录
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className='collection-searchbar'>
            <div className='search-field'>
              <Search size={18} />
              <Input
                ref={search}
                placeholder='搜索平台、账号、标签…'
                aria-label='搜索账号'
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelected([])
                }}
                maxLength={1000}
              />
              {query ? (
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label='清除搜索'
                  onClick={() => setQuery('')}
                >
                  <X size={15} />
                </Button>
              ) : (
                <kbd>⌘ K</kbd>
              )}
            </div>
            <FieldSelect
              aria-label='筛选主体'
              value={subject}
              onValueChange={(id) => {
                setSubject(id)
                setSelected([])
              }}
            >
              <FieldOption value='all'>全部主体</FieldOption>
              <FieldOption value=''>未分配主体</FieldOption>
              {data.subjects.map((s) => (
                <FieldOption value={s.id} key={s.id}>
                  {s.name}
                </FieldOption>
              ))}
            </FieldSelect>
            <Button
              variant='outline'
              aria-label='高级筛选'
              aria-expanded={showFilters}
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal size={16} />
              <span>筛选</span>
              {chips.length > 0 && (
                <span className='filter-count'>{chips.length}</span>
              )}
            </Button>
            <Button
              variant='outline'
              aria-label='自然语言查找'
              onClick={onAISearch}
            >
              <Sparkles size={16} />
              <span>智能查找</span>
            </Button>
          </div>
          {showFilters && (
            <div className='collection-filters'>
              <FieldSelect
                aria-label='筛选分类'
                value={criteria.category}
                onValueChange={(category) => patch({ category })}
              >
                <FieldOption value='all'>全部分类</FieldOption>
                {data.categories.map((c) => (
                  <FieldOption value={c} key={c}>
                    {c}
                  </FieldOption>
                ))}
              </FieldSelect>
              <FieldSelect
                aria-label='筛选状态'
                value={criteria.status}
                onValueChange={(status) =>
                  patch({ status: status as CollectionFilter['status'] })
                }
              >
                <FieldOption value='all'>全部状态</FieldOption>
                {Object.entries(statusNames).map(([s, name]) => (
                  <FieldOption value={s} key={s}>
                    {name}
                  </FieldOption>
                ))}
              </FieldSelect>
              <FieldSelect
                aria-label='筛选检查结果'
                value={criteria.issue}
                onValueChange={(issue) =>
                  patch({ issue: issue as CollectionFilter['issue'] })
                }
              >
                <FieldOption value='all'>全部检查结果</FieldOption>
                {Object.entries(issueNames).map(([v, name]) => (
                  <FieldOption value={v} key={v}>
                    {name}
                  </FieldOption>
                ))}
              </FieldSelect>
              <div className='filter-tags'>
                <span>同时包含标签</span>
                {allTags.length ? (
                  allTags.map((tag) => (
                    <Button
                      variant='outline'
                      size='sm'
                      key={tag}
                      aria-pressed={criteria.tags.includes(tag)}
                      onClick={() =>
                        patch({
                          tags: criteria.tags.includes(tag)
                            ? criteria.tags.filter((t) => t !== tag)
                            : [...criteria.tags, tag],
                        })
                      }
                    >
                      {tag}
                    </Button>
                  ))
                ) : (
                  <small>在账号中添加标签后可筛选</small>
                )}
              </div>
            </div>
          )}
          {!!chips.length && (
            <div className='active-filter-list' aria-label='当前筛选条件'>
              {chips.map((chip, index) => (
                <Button
                  size='sm'
                  variant='ghost'
                  key={index}
                  onClick={chip.remove}
                  aria-label={'移除筛选 ' + chip.label}
                >
                  {chip.label}
                  <X size={13} />
                </Button>
              ))}
              <Button variant='ghost' size='sm' onClick={reset}>
                清除全部
              </Button>
              <Button
                variant='outline'
                size='sm'
                onClick={() => {
                  setViewName('')
                  setViewError('')
                  setSavingView(true)
                }}
              >
                保存为视图
              </Button>
            </div>
          )}
          <div className='collection-resultbar'>
            <label className='select-results'>
              <Checkbox
                aria-label='选择当前筛选的全部账号'
                checked={
                  hasAll
                    ? true
                    : selectedAccounts.length
                      ? 'indeterminate'
                      : false
                }
                onCheckedChange={(v) =>
                  setSelected(v === true ? filtered.map((a) => a.id) : [])
                }
              />
              <span aria-live='polite'>
                {selectedAccounts.length
                  ? `已选 ${selectedAccounts.length} 个`
                  : `全选 · ${filtered.length} 个账号`}
              </span>
            </label>
            <div className='sort-select'>
              <ArrowDownUp size={14} />
              <FieldSelect
                aria-label='账号排序'
                value={sort}
                onValueChange={(v) => setSort(v as typeof sort)}
              >
                <FieldOption value='recent'>最近更新</FieldOption>
                <FieldOption value='name'>账号名称</FieldOption>
                <FieldOption value='expiry'>最早到期</FieldOption>
              </FieldSelect>
            </div>
          </div>
          {selectedAccounts.length > 0 && (
            <div className='bulk-toolbar' role='region' aria-label='批量操作'>
              <span>
                <CheckCheck size={16} />
                已选择 {selectedAccounts.length} 个账号
              </span>
              <Button
                size='sm'
                variant='outline'
                disabled={busy}
                onClick={() => setBulk(selectedAccounts)}
              >
                <Pencil size={15} />
                批量整理
              </Button>
              <Button
                size='sm'
                variant='ghost'
                disabled={busy}
                onClick={() => askDelete(selectedAccounts)}
              >
                <Trash2 size={15} />
                移入回收站
              </Button>
              <Button size='sm' variant='ghost' onClick={() => setSelected([])}>
                取消选择
              </Button>
            </div>
          )}
          <div className={['entry-collection', view, density].join(' ')}>
            {view === 'list' && (
              <div className='entry-column-head' aria-hidden='true'>
                <span />
                <span>平台 / 账号</span>
                <span>主体 / 分类</span>
                <span>状态 / 标签</span>
                <span>更新 / 到期</span>
                <span>快捷操作</span>
              </div>
            )}
            {filtered.map((account) => {
              const subjectItem = data.subjects.find(
                (s) => s.id === account.subjectId
              )
              const flags = issues.get(account.id) ?? []
              return (
                <article
                  className={
                    'entry-card' +
                    (selected.includes(account.id) ? ' selected' : '')
                  }
                  key={account.id}
                >
                  <Checkbox
                    className='entry-check'
                    aria-label={
                      '选择 ' + account.platform + ' ' + account.username
                    }
                    checked={selectedAccounts.some((a) => a.id === account.id)}
                    onCheckedChange={(checked) =>
                      setSelected((ids) =>
                        checked
                          ? [
                              ...ids.filter((id) => id !== account.id),
                              account.id,
                            ]
                          : ids.filter((id) => id !== account.id)
                      )
                    }
                  />
                  <div className='entry-identity'>
                    <PlatformIcon account={account} />
                    <Button
                      variant='ghost'
                      className='account-card-main entry-main'
                      title={`${account.alias || account.platform} · ${account.username}`}
                      onClick={() => onSelect(account)}
                    >
                      <strong>{account.alias || account.platform}</strong>
                      <span>
                        {account.alias && account.platform + ' · '}
                        {account.username}
                      </span>
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      className={
                        'entry-star' + (account.favorite ? ' is-favorite' : '')
                      }
                      aria-label={
                        (account.favorite ? '取消收藏 ' : '收藏 ') +
                        account.platform
                      }
                      aria-pressed={account.favorite}
                      onClick={() => onFavorite(account)}
                      disabled={busy}
                    >
                      <Star
                        size={16}
                        fill={account.favorite ? 'currentColor' : 'none'}
                      />
                    </Button>
                  </div>
                  <div className='entry-owner'>
                    <span>
                      <i
                        className={'subject-dot ' + (subjectItem?.color || '')}
                      />
                      {subjectItem?.name || '未分配主体'}
                    </span>
                    <small>{account.category}</small>
                    {flags.some((i) => i.type === 'due') && (
                      <small className='due-text'>
                        {expiryLabel(account, now)}
                      </small>
                    )}
                  </div>
                  <div className='entry-labels'>
                    <Badge
                      variant='outline'
                      className={'entry-status ' + account.status}
                    >
                      {statusNames[account.status]}
                    </Badge>
                    {account.tags.slice(0, 2).map((t) => (
                      <Badge variant='secondary' key={t}>
                        {t}
                      </Badge>
                    ))}
                    {account.tags.length > 2 && (
                      <small>+{account.tags.length - 2}</small>
                    )}
                  </div>
                  <div className='entry-dates'>
                    <time
                      title={new Date(account.updatedAt).toLocaleString(
                        'zh-CN'
                      )}
                    >
                      {displayDate(account.updatedAt)} 更新
                    </time>
                    {account.expiresOn && (
                      <small
                        className={
                          flags.some((i) => i.type === 'due') ? 'due-text' : ''
                        }
                      >
                        {expiryLabel(account, now)}
                      </small>
                    )}
                  </div>
                  <div className='entry-actions'>
                    <CopyButton value={account.username} />
                    <CopyButton
                      value={account.password}
                      label='密码'
                      disabled={!account.password}
                    />
                    {account.url && (
                      <Button variant='ghost' size='icon' asChild>
                        <a
                          href={account.url}
                          target='_blank'
                          rel='noopener noreferrer'
                          aria-label={'前往平台 ' + account.platform}
                          title='前往平台'
                        >
                          <ArrowUpRight size={17} />
                        </a>
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='ghost'
                          size='icon'
                          aria-label={'更多操作 ' + account.platform}
                        >
                          <MoreHorizontal size={17} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem onClick={() => onSelect(account)}>
                          查看详情与历史
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onEdit(account)}>
                          <Pencil size={15} />
                          编辑账号
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => askDelete([account])}>
                          <Trash2 size={15} />
                          移入回收站
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </article>
              )
            })}
          </div>
          {!filtered.length && (
            <EmptyState
              title={
                data.accounts.length
                  ? '没有符合这些条件的账号'
                  : '记录你的第一个账号'
              }
              text={
                data.accounts.length
                  ? '移除上方的筛选条件，或换个关键词。'
                  : '手动添加、导入表格，或让助手帮你整理。'
              }
            >
              <Button onClick={data.accounts.length ? reset : onAdd}>
                {data.accounts.length ? '清除全部筛选' : '添加账号'}
              </Button>
            </EmptyState>
          )}
        </section>
        <div className='collection-footnote'>
          {demo
            ? '示例空间 · 本次体验不会保存'
            : '账号与历史在设备上加密后保存'}
          <span>账号检查和到期提醒均在本机计算</span>
        </div>
      </div>
      <Suspense fallback={null}>
        {bulk && (
          <BulkEditor
            accounts={bulk}
            onClose={() => setBulk(null)}
            onSaved={() => setSelected([])}
          />
        )}
        {importing && (
          <TableImport
            defaultSubject={subject === 'all' ? '' : subject}
            onClose={() => setImporting(false)}
          />
        )}
        {tool && (
          <CollectionTools
            mode={tool}
            onClose={() => setTool(null)}
            onSelect={(a) => {
              setTool(null)
              onSelect(a)
            }}
          />
        )}
      </Suspense>
      {confirmation && (
        <Confirm value={confirmation} onClose={() => setConfirmation(null)} />
      )}
      <Dialog open={savingView} onOpenChange={setSavingView}>
        <DialogContent className='vault-dialog'>
          <DialogHeader>
            <DialogTitle>保存筛选视图</DialogTitle>
            <DialogDescription>
              以后点击视图名称，即可恢复当前主体、标签和搜索条件。
            </DialogDescription>
          </DialogHeader>
          <form
            className='editor-form'
            onSubmit={(e) => {
              e.preventDefault()
              void saveView()
            }}
          >
            <TextField
              label='视图名称'
              value={viewName}
              maxLength={200}
              required
              onChange={(e) => setViewName(e.target.value)}
              placeholder='例如：公司生产账号'
            />
            {viewError && (
              <div className='form-error' role='alert'>
                {viewError}
              </div>
            )}
            <Button type='submit' disabled={busy}>
              保存视图
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
