import {
  ArrowRight,
  Building2,
  FolderOpen,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type VaultData } from '../lib/model'

export function CollectionOverview({
  data,
  subject,
  setSubject,
  warnings,
  onHealth,
}: {
  data: VaultData
  subject: string
  setSubject: (id: string) => void
  warnings: number
  onHealth: () => void
}) {
  return (
    <aside className='library-sidebar' aria-label='账号归档'>
      <div className='library-sidebar-title'>
        <FolderOpen size={18} />
        <strong>我的空间</strong>
      </div>
      <Button
        variant='ghost'
        className='library-folder'
        aria-pressed={subject === 'all'}
        onClick={() => setSubject('all')}
      >
        <span>全部主体</span>
        <small>{data.accounts.length}</small>
      </Button>
      <div className='library-section-label'>
        <span>按主体查看</span>
        <Building2 size={13} />
      </div>
      <div className='library-folders'>
        {data.subjects.map((item) => (
          <Button
            key={item.id}
            variant='ghost'
            className='library-folder'
            aria-pressed={subject === item.id}
            onClick={() => setSubject(subject === item.id ? 'all' : item.id)}
          >
            <span className={`subject-dot ${item.color}`} />
            <span>{item.name}</span>
            <small>
              {
                data.accounts.filter((account) => account.subjectId === item.id)
                  .length
              }
            </small>
          </Button>
        ))}
        <Button
          variant='ghost'
          className='library-folder'
          aria-pressed={subject === ''}
          onClick={() => setSubject(subject === '' ? 'all' : '')}
        >
          <span className='subject-dot' />
          <span>未分配主体</span>
          <small>
            {data.accounts.filter((account) => !account.subjectId).length}
          </small>
        </Button>
      </div>
      <div className='library-health'>
        <ShieldCheck size={21} />
        <strong>整理好，也照看好。</strong>
        <p>
          {warnings
            ? `${warnings} 个账号有待查看事项`
            : '目前没有待处理的账号事项'}
        </p>
        <Button
          variant='ghost'
          onClick={onHealth}
          aria-label={`账号检查 ${warnings}`}
        >
          账号检查
          <ArrowRight size={15} />
        </Button>
      </div>
      <dl className='library-summary' aria-label='账号概览'>
        <div>
          <dt>主体</dt>
          <dd>{data.subjects.length}</dd>
        </div>
        <div>
          <dt>收藏</dt>
          <dd>{data.accounts.filter((account) => account.favorite).length}</dd>
        </div>
      </dl>
    </aside>
  )
}

export function QuickCapture({
  captureText,
  setCaptureText,
  onCapture,
}: {
  captureText: string
  setCaptureText: (value: string) => void
  onCapture: () => void
}) {
  return (
    <form
      className='quick-capture'
      onSubmit={(event) => {
        event.preventDefault()
        onCapture()
      }}
    >
      <span className='quick-capture-label'>
        <Sparkles size={17} />
        <strong>随手记</strong>
      </span>
      <Input
        aria-label='快速记录描述'
        value={captureText}
        onChange={(event) => setCaptureText(event.target.value)}
        maxLength={6000}
        placeholder='告诉我平台、账号和用途，密码在下一步填写'
      />
      <Button type='submit' variant='ghost'>
        开始记录
        <ArrowRight size={16} />
      </Button>
    </form>
  )
}
