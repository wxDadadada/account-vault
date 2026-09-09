import { useState, type FormEvent } from 'react'
import {
  ArrowRight,
  Building2,
  Ellipsis,
  FolderOpen,
  Pencil,
  Plus,
  Tag,
  Trash2,
  UserRound,
  Grid2X2,
  LayoutList,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Confirm, type Confirmation } from '../components/Confirm'
import { FieldSelect, FieldOption } from '../components/controls'
import { Field, TextField } from '../components/fields'
import { Busy, EmptyState, PageHeading } from '../components/ui'
import { useDiscardConfirmation } from '../hooks/use-discard-confirmation'
import { useDisplayPreference } from '../hooks/use-display-preference'
import { deleteSubject, saveAccount, saveSubject } from '../lib/domain'
import { type Subject } from '../lib/model'
import { useVault } from '../state/context'

export function SubjectsPage({
  onSelect,
  onTag,
}: {
  onSelect: (id: string) => void
  onTag: (tag: string) => void
}) {
  const { data, commit } = useVault()
  const [tab, setTab] = useState('subjects')
  const [view, setView] = useDisplayPreference(
    'subject-view',
    ['grid', 'list'] as const,
    'list'
  )
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<Subject | null | undefined>(undefined)
  const [category, setCategory] = useState<string | null | undefined>(undefined)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  if (!data) return null
  const tags = [...new Set(data.accounts.flatMap((a) => a.tags))].sort((a, b) =>
    a.localeCompare(b, 'zh-CN')
  )
  return (
    <div className='taxonomy-page'>
      <PageHeading title='主体与分类' subtitle='每个身份，都有清晰的归属。'>
        {tab !== 'tags' && (
          <Button
            className='primary-button'
            onClick={() =>
              tab === 'categories' ? setCategory(null) : setEditor(null)
            }
          >
            <Plus size={17} />
            {tab === 'categories' ? '添加分类' : '添加主体'}
          </Button>
        )}
      </PageHeading>
      <div className='collection-toolbar'>
        <div className='collection-tabs'>
          {[
            {
              id: 'subjects',
              name: '主体',
              icon: Building2,
              count: data.subjects.length,
            },
            {
              id: 'categories',
              name: '分类',
              icon: FolderOpen,
              count: data.categories.length,
            },
            { id: 'tags', name: '标签', icon: Tag, count: tags.length },
          ].map((t) => (
            <Button
              variant='ghost'
              type='button'
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={16} />
              {t.name}
              <span>{t.count}</span>
            </Button>
          ))}
        </div>
      </div>
      <div className='taxonomy-content'>
        {tab === 'subjects' && (
          <div className='subject-toolbar'>
            <TextField
              label='搜索主体'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='搜索名称或别名'
            />
            <div className='collection-display'>
              <Button
                variant='ghost'
                size='icon'
                aria-label='主体卡片视图'
                aria-pressed={view === 'grid'}
                onClick={() => setView('grid')}
              >
                <Grid2X2 size={18} />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                aria-label='主体列表视图'
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
              >
                <LayoutList size={18} />
              </Button>
            </div>
          </div>
        )}
        {tab === 'subjects' && (
          <div
            className={
              'subject-grid' + (view === 'list' ? ' subject-compact' : '')
            }
          >
            {data.subjects
              .filter((s) =>
                (s.name + ' ' + s.aliases.join(' '))
                  .toLowerCase()
                  .includes(query.toLowerCase())
              )
              .map((s) => (
                <article className='subject-card' key={s.id}>
                  <div className='subject-card-top'>
                    <span className={`subject-emblem ${s.color}`}>
                      {s.type === 'personal' ? <UserRound /> : <Building2 />}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size='icon'
                          variant='ghost'
                          aria-label={`管理 ${s.name}`}
                        >
                          <Ellipsis size={20} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem onClick={() => setEditor(s)}>
                          <Pencil size={15} />
                          编辑主体
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className='text-destructive'
                          onClick={() =>
                            setConfirmation({
                              title: `删除「${s.name}」？`,
                              description:
                                '仅未关联账号或历史记录的主体可以删除。',
                              label: '删除主体',
                              danger: true,
                              action: async () => {
                                await commit((d) => deleteSubject(d, s.id))
                                toast.success('主体已删除')
                              },
                            })
                          }
                        >
                          <Trash2 size={15} />
                          删除主体
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <Button
                    variant='ghost'
                    type='button'
                    className='subject-card-main'
                    onClick={() => onSelect(s.id)}
                  >
                    <h2>{s.name}</h2>
                    <p>
                      {s.type === 'personal' ? '个人主体' : '企业 / 工作室'}
                    </p>
                    <div className='subject-aliases'>
                      {s.aliases.length
                        ? s.aliases.join(' · ')
                        : '可添加别名，方便自然语言识别'}
                    </div>
                    <div className='subject-account-count'>
                      <strong>
                        {
                          data.accounts.filter((a) => a.subjectId === s.id)
                            .length
                        }
                      </strong>
                      <span>个账号</span>
                      <ArrowRight size={18} />
                    </div>
                  </Button>
                </article>
              ))}
            {!data.subjects.filter((s) =>
              (s.name + ' ' + s.aliases.join(' '))
                .toLowerCase()
                .includes(query.toLowerCase())
            ).length && (
              <EmptyState
                title={query ? '没有匹配的主体' : '给账号一个归属'}
                text={
                  query
                    ? '试试名称或其他别名。'
                    : '添加个人、公司或工作室主体。'
                }
              />
            )}
          </div>
        )}
        {tab === 'categories' && (
          <div className='management-list'>
            {data.categories.map((c) => {
              const count = data.accounts.filter((a) => a.category === c).length
              return (
                <div className='management-row' key={c}>
                  <span className='management-icon'>
                    <FolderOpen size={19} />
                  </span>
                  <div>
                    <strong>{c}</strong>
                    <span>{count} 个账号</span>
                  </div>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={`重命名分类 ${c}`}
                    onClick={() => setCategory(c)}
                  >
                    <Pencil size={16} />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='danger-ghost'
                    aria-label={`删除分类 ${c}`}
                    disabled={count > 0 || c === '其他'}
                    onClick={() =>
                      setConfirmation({
                        title: `删除「${c}」分类？`,
                        description: '这个分类当前没有关联账号。',
                        label: '删除分类',
                        danger: true,
                        action: async () => {
                          await commit((d) => {
                            if (d.accounts.some((a) => a.category === c))
                              throw new Error('分类已被使用')
                            d.categories = d.categories.filter((n) => n !== c)
                            return d
                          })
                          toast.success('分类已删除')
                        },
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              )
            })}
          </div>
        )}
        {tab === 'tags' &&
          (tags.length ? (
            <div className='tag-cloud'>
              {tags.map((t) => (
                <Button
                  variant='ghost'
                  type='button'
                  key={t}
                  onClick={() => onTag(t)}
                >
                  <Tag size={16} />
                  <strong>{t}</strong>
                  <span>
                    {data.accounts.filter((a) => a.tags.includes(t)).length}
                  </span>
                  <ArrowRight size={15} />
                </Button>
              ))}
            </div>
          ) : (
            <EmptyState
              title='标签会在这里汇集'
              text='编辑账号时添加项目或用途标签，即可快速归类。'
            />
          ))}
        {editor !== undefined && (
          <SubjectEditor
            initial={editor}
            onClose={() => setEditor(undefined)}
          />
        )}
        {category !== undefined && (
          <CategoryEditor
            initial={category}
            onClose={() => setCategory(undefined)}
          />
        )}
        {confirmation && (
          <Confirm value={confirmation} onClose={() => setConfirmation(null)} />
        )}
      </div>
    </div>
  )
}
function SubjectEditor({
  initial,
  onClose,
}: {
  initial: Subject | null
  onClose: () => void
}) {
  const { commit, busy } = useVault()
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<Subject['type']>(initial?.type ?? 'company')
  const [aliases, setAliases] = useState(initial?.aliases.join('，') ?? '')
  const [color, setColor] = useState(initial?.color ?? 'green')
  const [error, setError] = useState('')
  const { confirmDiscard, discardDialog, onEscapeKeyDown } =
    useDiscardConfirmation()
  const dirty =
    name !== (initial?.name ?? '') ||
    type !== (initial?.type ?? 'company') ||
    aliases !== (initial?.aliases.join('，') ?? '') ||
    color !== (initial?.color ?? 'green')
  function requestClose() {
    if (!busy) confirmDiscard({ when: dirty, action: onClose })
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await commit((d) =>
        saveSubject(d, {
          id: initial?.id ?? crypto.randomUUID(),
          name: name.trim(),
          type,
          aliases: [
            ...new Set(
              aliases
                .split(/[,，\n]/)
                .map((a) => a.trim())
                .filter(Boolean)
            ),
          ],
          color,
        })
      )
      toast.success(initial ? '主体已更新' : '主体已添加')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent className='vault-dialog' onEscapeKeyDown={onEscapeKeyDown}>
        <DialogHeader>
          <DialogTitle>{initial ? '编辑主体' : '添加主体'}</DialogTitle>
          <DialogDescription>
            个人、公司或工作室，让账号的归属一目了然。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className='editor-form'>
          <TextField
            label='主体名称'
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            autoFocus
          />
          <Field label='主体类型'>
            <FieldSelect
              aria-label='主体类型'
              value={type}
              onValueChange={(selectedValue) =>
                setType(selectedValue as Subject['type'])
              }
            >
              <FieldOption value='personal'>个人</FieldOption>
              <FieldOption value='company'>企业 / 工作室</FieldOption>
            </FieldSelect>
          </Field>
          <TextField
            label='别名'
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder='简称、公司全称等，用逗号分隔'
            maxLength={2000}
            hint='搜索和 AI 整理时，别名也能匹配到这个主体。'
          />
          <Field label='标记颜色'>
            <div className='color-options'>
              {[
                { key: 'green', label: '松绿' },
                { key: 'blue', label: '雾蓝' },
                { key: 'purple', label: '紫藤' },
                { key: 'orange', label: '琥珀' },
              ].map((c) => (
                <Button
                  variant='ghost'
                  type='button'
                  key={c.key}
                  className={color === c.key ? 'selected' : ''}
                  aria-pressed={color === c.key}
                  onClick={() => setColor(c.key)}
                >
                  <span className={`subject-dot ${c.key}`} />
                  {c.label}
                </Button>
              ))}
            </div>
          </Field>
          {error && (
            <div className='form-error' role='alert'>
              {error}
            </div>
          )}
          <div className='form-actions'>
            <Button
              variant='outline'
              type='button'
              disabled={busy}
              onClick={requestClose}
            >
              取消
            </Button>
            <Button className='primary-button' type='submit' disabled={busy}>
              {busy ? <Busy /> : '保存主体'}
            </Button>
          </div>
        </form>
      </DialogContent>
      {discardDialog}
    </Dialog>
  )
}
function CategoryEditor({
  initial,
  onClose,
}: {
  initial: string | null
  onClose: () => void
}) {
  const { commit, busy } = useVault()
  const [name, setName] = useState(initial ?? '')
  const [error, setError] = useState('')
  const { confirmDiscard, discardDialog, onEscapeKeyDown } =
    useDiscardConfirmation()
  function requestClose() {
    if (!busy)
      confirmDiscard({ when: name !== (initial ?? ''), action: onClose })
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await commit((d) => {
        const value = name.trim()
        if (!value || value.length > 100)
          throw new Error('分类名称需要 1–100 个字符')
        if (
          d.categories.some(
            (c) => c !== initial && c.toLowerCase() === value.toLowerCase()
          )
        )
          throw new Error('这个分类已存在')
        if (initial && initial !== value) {
          for (const account of d.accounts.filter(
            (a) => a.category === initial
          ))
            d = saveAccount(d, { ...account, category: value })
          d.categories = d.categories.filter((c) => c !== initial)
        }
        if (!d.categories.includes(value)) d.categories.push(value)
        return d
      })
      toast.success('分类已保存')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent className='vault-dialog' onEscapeKeyDown={onEscapeKeyDown}>
        <DialogHeader>
          <DialogTitle>{initial ? '重命名分类' : '添加分类'}</DialogTitle>
          <DialogDescription>
            {initial
              ? '使用此分类的账号也会同步更新并记录变更。'
              : '按业务或用途整理你的账号。'}
          </DialogDescription>
        </DialogHeader>
        <form className='editor-form' onSubmit={submit}>
          <TextField
            label='分类名称'
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            autoFocus
          />
          {error && (
            <div className='form-error' role='alert'>
              {error}
            </div>
          )}
          <Button className='primary-button' type='submit' disabled={busy}>
            {busy ? <Busy /> : '保存分类'}
          </Button>
        </form>
      </DialogContent>
      {discardDialog}
    </Dialog>
  )
}
