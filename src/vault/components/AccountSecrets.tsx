import { useEffect, useMemo, useState } from 'react'
import { Copy, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { copyValue } from '../lib/clipboard'
import { type Account } from '../lib/model'
import { parseTOTP } from '../lib/totp'

export function SecretValue({
  label,
  value,
  secret,
}: {
  label: string
  value: string
  secret: boolean
}) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!shown) return
    const timer = setTimeout(() => setShown(false), 30000)
    return () => clearTimeout(timer)
  }, [shown])
  return (
    <div className='credential-block custom-credential'>
      <div>
        <span>{label}</span>
        <strong className='custom-credential-value'>
          {secret && !shown && value ? '••••••••••••' : value || '未填写'}
        </strong>
      </div>
      <div className='credential-actions'>
        {secret && value && (
          <Button
            type='button'
            size='icon'
            variant='ghost'
            aria-label={(shown ? '隐藏' : '显示') + label}
            onClick={() => setShown(!shown)}
          >
            {shown ? <EyeOff size={17} /> : <Eye size={17} />}
          </Button>
        )}
        <Button
          type='button'
          size='icon'
          variant='ghost'
          disabled={!value}
          aria-label={'复制' + label}
          onClick={() => void copyValue(value, label)}
        >
          <Copy size={17} />
        </Button>
      </div>
    </div>
  )
}
export function AccountSecrets({ account }: { account: Account }) {
  return (
    <div className='account-extra-details'>
      {account.totp && <TOTPValue value={account.totp} />}
      {account.customFields?.map((field) => (
        <SecretValue key={field.id} {...field} />
      ))}
    </div>
  )
}
function TOTPValue({ value }: { value: string }) {
  const otp = useMemo(() => parseTOTP(value), [value])
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const code = otp.generate({ timestamp: now })
  const remaining = Math.ceil(otp.remaining({ timestamp: now }) / 1000)
  return (
    <div className='totp-panel'>
      <div>
        <span>一次性验证码</span>
        <strong className='totp-code'>
          {code.slice(0, code.length / 2)} {code.slice(code.length / 2)}
        </strong>
        <small>{remaining} 秒后更新</small>
      </div>
      <Button
        variant='outline'
        onClick={() => void copyValue(otp.generate(), '验证码')}
      >
        <Copy size={16} />
        复制验证码
      </Button>
      <progress
        aria-label='验证码剩余有效期'
        max={otp.period}
        value={remaining}
      />
    </div>
  )
}
