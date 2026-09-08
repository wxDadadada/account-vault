import { useState, type FormEvent } from 'react'
import { KeyRound, LockKeyhole, Plus } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { useDiscardConfirmation } from '../hooks/use-discard-confirmation'
import { accountTemplates, applyTemplate } from '../lib/account-templates'
import { saveAccount, saveSubject } from '../lib/domain'
import {
  type Account,
  type Change,
  statusNames,
  blankAccount,
} from '../lib/model'
import { accountSchema } from '../lib/validation'
import { useVault } from '../state/context'
import { AccountExtras } from './AccountExtras'
import { FieldSelect, FieldOption, Disclosure } from './controls'
import { Field, PasswordField, TextField } from './fields'
import { Busy } from './ui'

export function AccountEditor({
  initial,
  draft,
  defaultSubject = 'all',
  source = 'manual',
  onClose,
  onSaved,
}: {
  initial: Account | null
  draft?: Account
  defaultSubject?: string
  source?: Change['source']
  onClose: () => void
  onSaved?: () => void
}) {
  const { data, commit, busy } = useVault()
  const [form, setForm] = useState<Account>(
    () =>
      draft ??
      initial ??
      blankAccount(
        defaultSubject === 'all' ? data?.subjects[0]?.id : defaultSubject
      )
  )
  const [tagText, setTagText] = useState(form.tags.join('，'))
  const [startingForm] = useState(form)
  const [newSubject, setNewSubject] = useState('')
  const [error, setError] = useState('')
  const { confirmDiscard, discardDialog, onEscapeKeyDown } =
    useDiscardConfirmation()
  const dirty =
    !!draft ||
    JSON.stringify(form) !== JSON.stringify(startingForm) ||
    tagText !== startingForm.tags.join('，') ||
    !!newSubject
  function requestClose() {
    if (!busy) confirmDiscard({ when: dirty, action: onClose })
  }
  if (!data) return null
  function update<K extends keyof Account>(field: K, value: Account[K]) {
    setForm((f) => ({ ...f, [field]: value }))
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const subjectId =
      form.subjectId === '__new__' ? crypto.randomUUID() : form.subjectId
    const input = {
      ...form,
      subjectId,
      platform: form.platform.trim(),
      username: form.username.trim(),
      tags: [
        ...new Set(
          tagText
            .split(/[,，\n]/)
            .map((t) => t.trim())
            .filter(Boolean)
        ),
      ],
    }
    const parsed = accountSchema.safeParse(input)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      setError(
        issue.path[0] === 'totp'
          ? '验证码密钥无效，请填写有效的 Base32 密钥或 otpauth://totp 地址'
          : issue.path[0] === 'expiresOn'
            ? '请填写有效的到期日期'
            : issue.path[0] === 'customFields'
              ? '请填写自定义字段名称，单个字段内容最多 4096 个字符'
              : issue.path[0] === 'url'
                ? '请填写完整的 http 或 https 登录地址'
                : issue.path[0] === 'username'
                  ? '请填写账号或用于区分它的标识'
                  : issue.path[0] === 'platform'
                    ? '请填写平台名称'
                    : '有字段为空或内容过长，请检查后保存'
      )
      return
    }
    if (form.subjectId === '__new__' && !newSubject.trim()) {
      setError('请填写新主体的名称')
      return
    }
    try {
      await commit((current) => {
        if (form.subjectId === '__new__')
          current = saveSubject(current, {
            id: subjectId,
            name: newSubject.trim(),
            type: 'company',
            aliases: [],
            color: 'blue',
          })
        return saveAccount(current, input, source, initial)
      })
      toast.success(initial ? '账号已更新，变更已记录' : '账号已加入你的空间')
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试')
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        className='vault-dialog editor-dialog'
        onEscapeKeyDown={onEscapeKeyDown}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className='dialog-title-icon'>
            <KeyRound size={23} /> {initial ? '编辑账号' : '添加账号'}
          </DialogTitle>
          <DialogDescription>
            {source === 'ai'
              ? '已为你整理好信息，核对后即可保存。'
              : '记录基本信息，其他内容可以以后补充。'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className='editor-form'>
          {!initial && (
            <div className='account-templates'>
              <span>快速模板</span>
              {accountTemplates.map((t) => (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  key={t.name}
                  onClick={() => setForm((f) => applyTemplate(f, t.name))}
                >
                  {t.name}
                </Button>
              ))}
              <small>补充空字段，保留已填写内容</small>
            </div>
          )}
          <div className='form-grid'>
            <TextField
              label='平台名称 *'
              placeholder='例如：阿里云'
              value={form.platform}
              onChange={(e) => update('platform', e.target.value)}
              required
              maxLength={200}
              autoFocus
            />
            <TextField
              label='账号 / 登录标识 *'
              placeholder='邮箱、手机号或用户名'
              value={form.username}
              onChange={(e) => update('username', e.target.value)}
              required
              maxLength={320}
              autoComplete='off'
              autoCapitalize='none'
              spellCheck={false}
            />
          </div>
          <TextField
            label='账号别名'
            value={form.alias ?? ''}
            onChange={(e) => update('alias', e.target.value)}
            maxLength={200}
            placeholder='例如：阿里云 · 生产主账号'
            hint='用于区分同一平台的多个账号，留空则显示平台名称。'
          />
          <div className='form-grid'>
            <Field label='所属主体'>
              <FieldSelect
                aria-label='所属主体'
                value={form.subjectId}
                onValueChange={(selectedValue) =>
                  update('subjectId', selectedValue)
                }
              >
                <FieldOption value=''>暂不分配</FieldOption>
                {data.subjects.map((s) => (
                  <FieldOption key={s.id} value={s.id}>
                    {s.name}
                  </FieldOption>
                ))}
                <FieldOption value='__new__'>＋ 新建主体</FieldOption>
              </FieldSelect>
            </Field>
            <Field label='分类'>
              <FieldSelect
                aria-label='账号分类'
                value={form.category}
                onValueChange={(selectedValue) =>
                  update('category', selectedValue)
                }
              >
                {[...new Set([...data.categories, form.category])].map((c) => (
                  <FieldOption value={c} key={c}>
                    {c}
                  </FieldOption>
                ))}
              </FieldSelect>
            </Field>
          </div>
          {form.subjectId === '__new__' && (
            <TextField
              label='新主体名称'
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              placeholder='例如：星河科技'
              required
              maxLength={200}
            />
          )}
          <PasswordField
            label='密码'
            value={form.password}
            onChange={(v) => update('password', v)}
            generate
            placeholder='粘贴密码，或点右侧生成'
          />
          <div className='secure-note'>
            <LockKeyhole size={14} /> 密码在设备上加密，不会发送给 AI。
          </div>
          <TextField
            label='登录地址'
            placeholder='https://'
            value={form.url}
            onChange={(e) => update('url', e.target.value)}
            maxLength={2048}
            type='url'
            inputMode='url'
          />
          <TextField
            label='标签'
            placeholder='例如：生产环境，商城项目'
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            hint='多个标签用逗号分隔'
            maxLength={2400}
          />
          <Disclosure
            className='advanced-fields'
            title='更多账号信息'
            defaultOpen={!!(form.phone || form.email || form.notes)}
          >
            <div className='advanced-content'>
              <div className='form-grid'>
                <TextField
                  label='绑定邮箱'
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  type='email'
                  maxLength={320}
                />
                <TextField
                  label='绑定手机'
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  type='tel'
                  maxLength={64}
                />
              </div>
              <div className='form-grid'>
                <Field label='登录方式'>
                  <FieldSelect
                    aria-label='登录方式'
                    value={form.loginMethod}
                    onValueChange={(selectedValue) =>
                      update('loginMethod', selectedValue)
                    }
                  >
                    {[
                      ...new Set([
                        '密码登录',
                        '手机验证码',
                        '邮箱验证码',
                        '第三方登录',
                        '其他',
                        form.loginMethod,
                      ]),
                    ].map((m) => (
                      <FieldOption value={m} key={m}>
                        {m}
                      </FieldOption>
                    ))}
                  </FieldSelect>
                </Field>
                <Field label='状态'>
                  <FieldSelect
                    aria-label='账号状态'
                    value={form.status}
                    onValueChange={(selectedValue) =>
                      update('status', selectedValue as Account['status'])
                    }
                  >
                    {Object.entries(statusNames).map(([value, label]) => (
                      <FieldOption key={value} value={value}>
                        {label}
                      </FieldOption>
                    ))}
                  </FieldSelect>
                </Field>
              </div>
              <Field label='备注'>
                <Textarea
                  aria-label='账号备注'
                  value={form.notes}
                  onChange={(e) => update('notes', e.target.value)}
                  placeholder='用途、注意事项、找回方式…'
                  maxLength={20000}
                  rows={3}
                />
              </Field>
            </div>
          </Disclosure>
          <AccountExtras
            account={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          />
          <label className='checkbox-row'>
            <Checkbox
              checked={form.favorite}
              onCheckedChange={(v) => update('favorite', v === true)}
            />{' '}
            加入收藏，方便下次查找
          </label>
          {error && (
            <div className='form-error' role='alert'>
              {error}
            </div>
          )}
          <div className='form-actions'>
            <Button
              type='button'
              variant='outline'
              disabled={busy}
              onClick={requestClose}
            >
              取消
            </Button>
            <Button type='submit' className='primary-button' disabled={busy}>
              {busy ? (
                <Busy text='正在加密保存…' />
              ) : (
                <>
                  <Plus size={17} />
                  {initial ? '保存修改' : '保存账号'}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
      {discardDialog}
    </Dialog>
  )
}
