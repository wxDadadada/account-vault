import {
  ArrowRight,
  ArrowUpRight,
  KeyRound,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function CollectionOverview({
  accounts,
  subjects,
  favorites,
  warnings,
  captureText,
  setCaptureText,
  onCapture,
  onHealth,
}: {
  accounts: number
  subjects: number
  favorites: number
  warnings: number
  captureText: string
  setCaptureText: (text: string) => void
  onCapture: () => void
  onHealth: () => void
}) {
  return (
    <div className='collection-overview'>
      <form
        className='capture-studio'
        onSubmit={(e) => {
          e.preventDefault()
          onCapture()
        }}
      >
        <div className='capture-studio-copy'>
          <span className='studio-label'>
            <Sparkles size={15} /> 拾钥整理助手
          </span>
          <h2>新账号，随手记下来。</h2>
          <p>告诉我平台和账号，帮你整理、归档。</p>
        </div>
        <div className='studio-art' aria-hidden='true'>
          <span className='studio-card-back' />
          <span className='studio-card-front'>
            <KeyRound size={26} strokeWidth={1.4} />
            <i />
            <i />
          </span>
          <span className='studio-spark'>
            <Sparkles size={15} />
          </span>
        </div>
        <div className='studio-input'>
          <Input
            aria-label='快速记录描述'
            value={captureText}
            onChange={(e) => setCaptureText(e.target.value)}
            maxLength={6000}
            placeholder='平台、账号和用途，密码在下一步填写'
          />
          <Button type='submit'>
            开始记录 <ArrowUpRight size={16} />
          </Button>
        </div>
      </form>
      <section className='space-ledger' aria-label='账号概览'>
        <div className='space-ledger-top'>
          <span>我的数字空间</span>
          <KeyRound size={17} />
        </div>
        <div className='space-ledger-numbers'>
          <div className='ledger-total'>
            <strong>{String(accounts).padStart(2, '0')}</strong>
            <span>个账号</span>
          </div>
          <div className='ledger-detail'>
            <span>
              <b>{subjects}</b> 个主体
            </span>
            <span>
              <b>{favorites}</b> 个收藏
            </span>
          </div>
        </div>
        <Button
          variant='ghost'
          className='ledger-health'
          onClick={onHealth}
          aria-label={`账号检查 ${warnings}`}
        >
          <ShieldCheck size={17} />
          <span>账号检查</span>
          <small>{warnings ? `${warnings} 项待查看` : '状态良好'}</small>
          <ArrowRight size={15} />
        </Button>
      </section>
    </div>
  )
}
