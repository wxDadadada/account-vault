import { useRef, useState } from 'react'
import { Upload, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useDiscardConfirmation } from '../hooks/use-discard-confirmation'
import {
  applyImport,
  importFields,
  parseTable,
  previewImport,
  suggestMapping,
  type ColumnMapping,
  type ImportField,
  type ImportRow,
} from '../lib/table-import'
import { useVault } from '../state/context'
import { FieldSelect, FieldOption } from './controls'
import { Field } from './fields'
import { Busy } from './ui'

export function TableImport({
  defaultSubject,
  onClose,
}: {
  defaultSubject: string
  onClose: () => void
}) {
  const { data, commit, busy } = useVault()
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [filename, setFilename] = useState('')
  const [table, setTable] = useState<ReturnType<typeof parseTable> | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [policy, setPolicy] = useState<'skip' | 'update'>('skip')
  const [subject, setSubject] = useState(defaultSubject)
  const [preview, setPreview] = useState<ImportRow[] | null>(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const { confirmDiscard, discardDialog, onEscapeKeyDown } =
    useDiscardConfirmation()
  const close = () =>
    !busy && !reading && confirmDiscard({ when: !!text, action: onClose })
  const change = (value: string) => {
    setText(value)
    setTable(null)
    setPreview(null)
    setError('')
  }
  function inspect() {
    setError('')
    try {
      const parsed = parseTable(text)
      setTable(parsed)
      setMapping(suggestMapping(parsed.headers))
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取表格')
    }
  }
  function review() {
    setError('')
    try {
      setPreview(previewImport(data!, table!.rows, mapping, policy, subject))
    } catch (e) {
      setError(e instanceof Error ? e.message : '请检查列对应关系')
    }
  }
  async function save() {
    if (!preview) return
    setError('')
    try {
      await commit((d) => applyImport(d, preview))
      toast.success(
        `已导入 ${preview.filter((r) => r.action === 'add' || r.action === 'update').length} 个账号`
      )
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败')
    }
  }
  const counts = (action: ImportRow['action']) =>
    preview?.filter((r) => r.action === action).length ?? 0
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className='vault-dialog table-import-dialog'
        onEscapeKeyDown={onEscapeKeyDown}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>导入账号表格</DialogTitle>
          <DialogDescription>
            选择 CSV／TSV，或从 Excel 复制包含列名的表格。最多 1000
            行，文件不超过 2 MB。
          </DialogDescription>
        </DialogHeader>
        <div className='import-steps' aria-label='导入进度'>
          <span className={!table ? 'active' : ''}>1 读取表格</span>
          <span className={table && !preview ? 'active' : ''}>2 对应字段</span>
          <span className={preview ? 'active' : ''}>3 核对导入</span>
        </div>
        {!table ? (
          <div className='editor-form'>
            <Input
              ref={input}
              type='file'
              accept='.csv,.tsv,text/csv,text/tab-separated-values'
              className='sr-only'
              aria-label='选择账号表格'
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                if (file.size > 2_000_000) {
                  setError('文件不能超过 2 MB')
                  return
                }
                setReading(true)
                void file
                  .text()
                  .then((value) => {
                    change(value)
                    setFilename(file.name)
                  })
                  .catch(() => setError('文件读取失败，请重试'))
                  .finally(() => setReading(false))
                e.target.value = ''
              }}
            />
            <Button
              variant='outline'
              disabled={reading}
              onClick={() => input.current?.click()}
            >
              <Upload size={17} />
              {reading ? '读取中…' : filename || '选择 CSV / TSV 文件'}
            </Button>
            <Field
              label='表格内容'
              hint='第一行填写列名，例如：平台、账号、密码、所属主体、标签。'
            >
              <Textarea
                aria-label='导入表格内容'
                className='import-paste'
                rows={8}
                value={text}
                onChange={(e) => {
                  change(e.target.value)
                  setFilename('')
                }}
                maxLength={2_000_000}
                placeholder={
                  '平台,账号,密码,所属主体\n示例平台,user@example.com,,我个人'
                }
                spellCheck={false}
                autoComplete='off'
              />
            </Field>
            <p className='inline-note'>
              在本机解析，密码和验证码密钥不会交给
              AI。粘贴内容可能包含明文密码，关闭导入窗口后会清除。
            </p>
            <Button disabled={!text.trim() || reading} onClick={inspect}>
              读取并对应字段
            </Button>
          </div>
        ) : !preview ? (
          <div className='editor-form'>
            <div className='import-mapping'>
              {(Object.entries(importFields) as [ImportField, string][]).map(
                ([key, label]) => (
                  <Field
                    label={`${label}${['platform', 'username'].includes(key) ? ' *' : ''}`}
                    key={key}
                  >
                    <FieldSelect
                      aria-label={`对应${label}列`}
                      value={
                        mapping[key] === undefined
                          ? '__none__'
                          : String(mapping[key])
                      }
                      onValueChange={(v) =>
                        setMapping((m) => {
                          const next = { ...m }
                          if (v === '__none__') delete next[key]
                          else next[key] = Number(v)
                          return next
                        })
                      }
                    >
                      <FieldOption value='__none__'>不导入此字段</FieldOption>
                      {table.headers.map((h, i) => (
                        <FieldOption key={i} value={String(i)}>
                          {i + 1}. {h.slice(0, 60) || '未命名列'}
                        </FieldOption>
                      ))}
                    </FieldSelect>
                  </Field>
                )
              )}
            </div>
            <Field label='未填写主体时归属'>
              <FieldSelect
                aria-label='导入默认主体'
                value={subject}
                onValueChange={setSubject}
              >
                <FieldOption value=''>暂不分配</FieldOption>
                {data!.subjects.map((s) => (
                  <FieldOption value={s.id} key={s.id}>
                    {s.name}
                  </FieldOption>
                ))}
              </FieldSelect>
            </Field>
            <Field label='重复账号处理'>
              <FieldSelect
                aria-label='重复账号处理'
                value={policy}
                onValueChange={(v) => setPolicy(v as 'skip' | 'update')}
              >
                <FieldOption value='skip'>跳过，保留已有账号</FieldOption>
                <FieldOption value='update'>
                  更新已对应的字段，并保留历史
                </FieldOption>
              </FieldSelect>
            </Field>
            <p className='inline-note'>
              主体、平台、账号和登录地址完全对应时视为重复。更新模式下，已对应列中的空值也会覆盖原值；未对应字段保持原值。新主体按公司／工作室创建，可在主体页调整类型。
            </p>
            <div className='form-actions'>
              <Button variant='outline' onClick={() => setTable(null)}>
                <ArrowLeft size={16} />
                返回内容
              </Button>
              <Button onClick={review}>预览 {table.rows.length} 行</Button>
            </div>
          </div>
        ) : (
          <div className='editor-form'>
            <div className='import-counts'>
              <span>
                新增 <b>{counts('add')}</b>
              </span>
              <span>
                更新 <b>{counts('update')}</b>
              </span>
              <span>
                跳过 <b>{counts('skip')}</b>
              </span>
              <span>
                错误 <b>{counts('error')}</b>
              </span>
            </div>
            <div
              className='import-row-list'
              role='region'
              aria-label='导入逐行预览'
            >
              {preview.map((row) => (
                <div
                  key={row.line}
                  className={`import-row ${row.error ? 'has-error' : ''}`}
                >
                  <span>第 {row.line} 行</span>
                  <div>
                    <strong>
                      {row.account?.alias ||
                        row.account?.platform ||
                        '无法导入'}{' '}
                      {row.account?.username}
                    </strong>
                    <small>
                      {row.error ||
                        `${row.subjectName || data!.subjects.find((s) => s.id === row.account?.subjectId)?.name || '暂不分配'} · ${{ add: '新增', update: '更新', skip: '重复跳过', error: '错误' }[row.action]}`}
                    </small>
                    {row.action === 'update' && (
                      <small>
                        将覆盖：
                        {(Object.keys(mapping) as ImportField[])
                          .map((k) => importFields[k])
                          .join('、')}
                      </small>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className='inline-note'>
              密码与验证码密钥在预览中隐藏。请修正错误行后再导入，整批内容会一起加密保存。
            </p>
            <div className='form-actions'>
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                返回调整
              </Button>
              <Button
                disabled={
                  busy ||
                  !!counts('error') ||
                  !(counts('add') + counts('update'))
                }
                onClick={() => void save()}
              >
                {busy ? <Busy text='正在加密导入…' /> : '确认导入'}
              </Button>
            </div>
          </div>
        )}
        {error && (
          <div className='form-error' role='alert'>
            {error}
          </div>
        )}
        {discardDialog}
      </DialogContent>
    </Dialog>
  )
}
