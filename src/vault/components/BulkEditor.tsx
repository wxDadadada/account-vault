import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useDiscardConfirmation } from '../hooks/use-discard-confirmation'
import { bulkUpdate } from '../lib/collection'
import { type Account, statusNames } from '../lib/model'
import { useVault } from '../state/context'
import { FieldOption, FieldSelect } from './controls'
import { Field, TextField } from './fields'
import { Busy } from './ui'

export function BulkEditor({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: Account[]
  onClose: () => void
  onSaved: () => void
}) {
  const { data, commit, busy } = useVault()
  const [subject, setSubject] = useState('__keep__')
  const [category, setCategory] = useState('__keep__')
  const [status, setStatus] = useState('__keep__')
  const [favorite, setFavorite] = useState('__keep__')
  const [addTags, setAddTags] = useState('')
  const [removeTags, setRemoveTags] = useState('')
  const [error, setError] = useState('')
  const { confirmDiscard, discardDialog, onEscapeKeyDown } =
    useDiscardConfirmation()
  const dirty =
    [subject, category, status, favorite].some((v) => v !== '__keep__') ||
    !!addTags ||
    !!removeTags
  const close = () => !busy && confirmDiscard({ when: dirty, action: onClose })
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const tags = (value: string) =>
      value
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean)
    const added = tags(addTags),
      removed = tags(removeTags)
    if (added.some((tag) => removed.includes(tag))) {
      setError('同一个标签不能同时添加和移除')
      return
    }
    try {
      await commit((d) =>
        bulkUpdate(d, accounts, {
          ...(subject !== '__keep__' ? { subjectId: subject } : {}),
          ...(category !== '__keep__' ? { category } : {}),
          ...(status !== '__keep__'
            ? { status: status as Account['status'] }
            : {}),
          ...(favorite !== '__keep__' ? { favorite: favorite === 'yes' } : {}),
          addTags: added,
          removeTags: removed,
        })
      )
      toast.success(`已整理 ${accounts.length} 个账号`)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '批量保存失败')
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className='vault-dialog editor-dialog'
        onEscapeKeyDown={onEscapeKeyDown}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>批量整理 {accounts.length} 个账号</DialogTitle>
          <DialogDescription>
            只更新你选择的字段，每个账号都会保留变更记录。
          </DialogDescription>
        </DialogHeader>
        <form className='editor-form' onSubmit={submit}>
          <div className='selection-summary'>
            {accounts
              .slice(0, 5)
              .map((a) => a.alias || `${a.platform} · ${a.username}`)
              .join('、')}
            {accounts.length > 5 && ` 等 ${accounts.length} 个账号`}
          </div>
          <div className='form-grid'>
            <Field label='所属主体'>
              <FieldSelect
                aria-label='批量所属主体'
                value={subject}
                onValueChange={setSubject}
              >
                <FieldOption value='__keep__'>保持原值</FieldOption>
                <FieldOption value=''>暂不分配</FieldOption>
                {data!.subjects.map((s) => (
                  <FieldOption value={s.id} key={s.id}>
                    {s.name}
                  </FieldOption>
                ))}
              </FieldSelect>
            </Field>
            <Field label='分类'>
              <FieldSelect
                aria-label='批量分类'
                value={category}
                onValueChange={setCategory}
              >
                <FieldOption value='__keep__'>保持原值</FieldOption>
                {data!.categories.map((c) => (
                  <FieldOption value={c} key={c}>
                    {c}
                  </FieldOption>
                ))}
              </FieldSelect>
            </Field>
            <Field label='状态'>
              <FieldSelect
                aria-label='批量状态'
                value={status}
                onValueChange={setStatus}
              >
                <FieldOption value='__keep__'>保持原值</FieldOption>
                {Object.entries(statusNames).map(([v, label]) => (
                  <FieldOption value={v} key={v}>
                    {label}
                  </FieldOption>
                ))}
              </FieldSelect>
            </Field>
            <Field label='收藏'>
              <FieldSelect
                aria-label='批量收藏'
                value={favorite}
                onValueChange={setFavorite}
              >
                <FieldOption value='__keep__'>保持原值</FieldOption>
                <FieldOption value='yes'>加入收藏</FieldOption>
                <FieldOption value='no'>取消收藏</FieldOption>
              </FieldSelect>
            </Field>
          </div>
          <TextField
            label='添加标签'
            value={addTags}
            onChange={(e) => setAddTags(e.target.value)}
            maxLength={2400}
            placeholder='用逗号分隔，保留其他标签'
          />
          <TextField
            label='移除标签'
            value={removeTags}
            onChange={(e) => setRemoveTags(e.target.value)}
            maxLength={2400}
            placeholder='用逗号分隔'
          />
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
              onClick={close}
            >
              取消
            </Button>
            <Button type='submit' disabled={busy || !dirty}>
              {busy ? <Busy text='正在保存…' /> : '确认批量修改'}
            </Button>
          </div>
        </form>
        {discardDialog}
      </DialogContent>
    </Dialog>
  )
}
