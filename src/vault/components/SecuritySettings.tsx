import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound, ShieldCheck, Smartphone } from 'lucide-react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '../lib/api'
import { copyValue } from '../lib/clipboard'
import { deriveMaster } from '../lib/crypto'
import { sessionEpoch } from '../lib/lock-sync'
import { useVault } from '../state/context'
import { PasswordField, TextField } from './fields'
import { Busy } from './ui'

export function SecuritySettings() {
  const vault = useVault()
  const [totpEnabled, setTotpEnabled] = useState(false)
  const [mode, setMode] = useState<'master' | 'totp' | null>(null)
  const [statusError, setStatusError] = useState('')
  useEffect(() => {
    if (!vault.demo)
      void api<{ totpEnabled: boolean }>('/security')
        .then((v) => setTotpEnabled(v.totpEnabled))
        .catch(() => setStatusError('安全状态加载失败，请刷新重试'))
  }, [vault.demo])
  return (
    <section className='settings-card'>
      <div className='settings-card-heading'>
        <span className='settings-icon'>
          <ShieldCheck size={20} />
        </span>
        <div>
          <h2>登录与安全</h2>
          <p>保护账号空间的入口。</p>
        </div>
      </div>
      <div className='security-row'>
        <KeyRound size={20} />
        <div>
          <strong>主密码</strong>
          <p>在设备上派生解密密钥</p>
        </div>
        <Button
          variant='outline'
          onClick={() => setMode('master')}
          disabled={vault.demo}
        >
          修改
        </Button>
      </div>
      <div className='security-row'>
        <Smartphone size={20} />
        <div>
          <strong>双重验证</strong>
          <p>
            {totpEnabled
              ? '已开启 · 登录需要验证器验证码'
              : '使用验证器提供额外保护'}
          </p>
        </div>
        <Button
          variant='outline'
          onClick={() => setMode('totp')}
          disabled={vault.demo}
        >
          {totpEnabled ? '管理' : '开启'}
        </Button>
      </div>
      {statusError && <div className='form-error'>{statusError}</div>}
      <div className='inline-note'>
        恢复密钥可用于重设主密码和双重验证。旧备份仍需用备份创建时的主密码或恢复密钥解密。
      </div>
      {mode === 'master' && <MasterDialog onClose={() => setMode(null)} />}
      {mode === 'totp' && (
        <TotpDialog
          enabled={totpEnabled}
          onClose={() => setMode(null)}
          onDisabled={() => {
            setTotpEnabled(false)
            setMode(null)
          }}
        />
      )}
    </section>
  )
}
function MasterDialog({ onClose }: { onClose: () => void }) {
  const { changeMaster, busy } = useVault()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (next !== confirm) {
      setError('两次新主密码不一致')
      return
    }
    if (next.length < 12 || next.length > 256) {
      setError('新主密码需要 12–256 个字符')
      return
    }
    try {
      await changeMaster(current, next)
      onClose()
      toast.success('主密码已更新，请保存新的恢复密钥')
    } catch (e) {
      setError(e instanceof Error ? e.message : '修改失败')
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className='vault-dialog'>
        <DialogHeader>
          <DialogTitle>修改主密码</DialogTitle>
          <DialogDescription>
            修改后其他设备会退出，并生成新的恢复密钥。
          </DialogDescription>
        </DialogHeader>
        <form className='editor-form' onSubmit={submit}>
          <PasswordField
            label='当前主密码'
            value={current}
            onChange={setCurrent}
            required
            autoComplete='current-password'
          />
          <PasswordField
            label='新主密码'
            value={next}
            onChange={setNext}
            required
            minLength={12}
          />
          <PasswordField
            label='再次输入新主密码'
            value={confirm}
            onChange={setConfirm}
            required
          />
          {error && (
            <div className='form-error' role='alert'>
              {error}
            </div>
          )}
          <Button className='primary-button' type='submit' disabled={busy}>
            {busy ? <Busy /> : '更新主密码'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
function TotpDialog({
  enabled,
  onClose,
  onDisabled,
}: {
  enabled: boolean
  onClose: () => void
  onDisabled: () => void
}) {
  const { profile, lock } = useVault()
  const [password, setPassword] = useState('')
  const [otp, setOTP] = useState('')
  const [secret, setSecret] = useState('')
  const [qr, setQR] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    const generation = sessionEpoch()
    setBusy(true)
    setError('')
    try {
      if (enabled) {
        const { authProof } = await deriveMaster(password, profile!.kdfSalt)
        if (sessionEpoch() !== generation) return
        await api('/security/totp/disable', { authProof, otp })
        toast.success('双重验证已关闭')
        onDisabled()
      } else if (!secret) {
        const { authProof } = await deriveMaster(password, profile!.kdfSalt)
        if (sessionEpoch() !== generation) return
        const result = await api<{ secret: string; uri: string }>(
          '/security/totp/start',
          { authProof }
        )
        setSecret(result.secret)
        setQR(
          await QRCode.toDataURL(result.uri, {
            width: 200,
            margin: 2,
            color: { dark: '#172b23', light: '#ffffff' },
          })
        )
        setPassword('')
      } else {
        await api('/security/totp/enable', { otp })
        onClose()
        lock()
        toast.success('双重验证已开启，请等待下一组验证码后重新解锁')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className='vault-dialog'>
        <DialogHeader>
          <DialogTitle>{enabled ? '关闭双重验证' : '开启双重验证'}</DialogTitle>
          <DialogDescription>
            {secret
              ? '用验证器扫描二维码，输入动态验证码完成绑定。'
              : '先验证主密码。可使用支持 TOTP 的验证器。'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className='editor-form'>
          {!secret && (
            <PasswordField
              label='主密码'
              value={password}
              onChange={setPassword}
              required
              autoComplete='current-password'
            />
          )}
          {qr && (
            <div className='totp-setup'>
              <img src={qr} width='200' height='200' alt='验证器绑定二维码' />
              <Button
                type='button'
                variant='ghost'
                onClick={() => void copyValue(secret, '验证器设置密钥')}
              >
                无法扫码？复制设置密钥
              </Button>
            </div>
          )}
          {(secret || enabled) && (
            <TextField
              label='6 位验证码'
              value={otp}
              onChange={(e) =>
                setOTP(e.target.value.replace(/\D/g, '').slice(0, 6))
              }
              required
              inputMode='numeric'
              autoComplete='one-time-code'
            />
          )}
          {error && (
            <div className='form-error' role='alert'>
              {error}
            </div>
          )}
          <Button className='primary-button' type='submit' disabled={busy}>
            {busy ? (
              <Busy />
            ) : enabled ? (
              '确认关闭'
            ) : secret ? (
              '验证并开启'
            ) : (
              '继续'
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
