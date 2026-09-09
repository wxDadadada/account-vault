import { useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileKey2,
  Fingerprint,
  History,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { BackupPicker, Disclosure } from '../components/controls'
import { PasswordField, TextField } from '../components/fields'
import { Brand, Busy } from '../components/ui'
import { APIError } from '../lib/api'
import { copyValue } from '../lib/clipboard'
import { readBackup } from '../lib/crypto'
import { downloadText } from '../lib/download'
import { useVault } from '../state/context'

export function AuthScreen() {
  const vault = useVault()
  const setup = vault.phase === 'setup'
  const [recovery, setRecovery] = useState(false)
  const [username, setUsername] = useState(vault.profile?.username ?? 'owner')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [otp, setOTP] = useState('')
  const [needOTP, setNeedOTP] = useState(false)
  const [recoveryInput, setRecoveryInput] = useState('')
  const [error, setError] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [backup, setBackup] = useState<string | null>(null)
  const [backupName, setBackupName] = useState('')
  const [backupSecret, setBackupSecret] = useState('')
  const [backupRecovery, setBackupRecovery] = useState(false)
  const [working, setWorking] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setWorking(true)
    try {
      if ((setup || recovery) && password !== confirm)
        throw new Error('两次输入的主密码不一致')
      if (
        (setup || recovery) &&
        (password.length < 12 || password.length > 256)
      )
        throw new Error('主密码需要 12–256 个字符，建议使用几个不相关的词组合')
      if (recovery) await vault.recover(recoveryInput, password)
      else if (setup) {
        let restored
        if (backup) {
          try {
            restored = await readBackup(backup, backupSecret, backupRecovery)
          } catch {
            throw new Error('备份解密失败，请核对文件和对应的密码或恢复密钥')
          }
        }
        await vault.initialize(username, password, restored, setupToken)
      } else await vault.unlock(username, password, otp)
      setPassword('')
      setConfirm('')
      setRecoveryInput('')
      setBackupSecret('')
    } catch (e) {
      if (e instanceof APIError && e.code === 'TOTP_REQUIRED') setNeedOTP(true)
      setError(e instanceof Error ? e.message : '操作失败，请重试')
    } finally {
      setWorking(false)
    }
  }
  const disabled = working || vault.busy
  return (
    <div className='auth-layout'>
      <aside className='auth-story'>
        <Brand />
        <div className='auth-story-content'>
          <span className='auth-kicker'>YOUR DIGITAL LIFE, IN ORDER</span>
          <h1>
            把账号，
            <br />
            妥帖收好<span>。</span>
          </h1>
          <p>
            个人、公司、项目。
            <br />
            把分散的数字身份，整理在一处。
          </p>
          <div className='auth-features'>
            <span>
              <Fingerprint size={20} /> 按主体归档
            </span>
            <span>
              <History size={20} /> 留下每次变更
            </span>
            <span>
              <Sparkles size={20} /> 说一句就记录
            </span>
          </div>
        </div>
        <div className='vault-object' aria-hidden='true'>
          <div className='object-orbit' />
          <div className='object-back-card'>
            <span>PERSONAL</span>
          </div>
          <div className='object-middle-card'>
            <span>WORK</span>
          </div>
          <div className='object-front-card'>
            <div className='object-card-top'>
              <KeyRound size={28} />
              <span>KEYFOLIO / PRIVATE</span>
            </div>
            <span className='object-card-title'>
              Everything.
              <br />
              In its place.
            </span>
            <div className='object-card-bottom'>
              <span className='object-chip' />
              <LockKeyhole size={19} />
            </div>
          </div>
          <div className='object-seal'>
            <Check size={22} />
          </div>
        </div>
        <div className='auth-story-footer'>
          <ShieldCheck size={18} />
          <span>浏览器端加密 · 自己掌握密钥</span>
        </div>
      </aside>
      <section className='auth-main'>
        <div className='auth-mobile-brand'>
          <Brand />
        </div>
        {vault.phase === 'loading' ? (
          <div className='auth-form'>
            <Busy text='正在连接你的账号空间…' />
          </div>
        ) : vault.phase === 'error' ? (
          <div className='auth-form'>
            <span className='auth-icon'>
              <LockKeyhole size={29} />
            </span>
            <h2>暂时无法连接账号库</h2>
            <p>{vault.startupError}</p>
            <Button
              className='primary-button'
              onClick={() => void vault.retry()}
            >
              重新连接
            </Button>
            <Button variant='ghost' onClick={vault.startDemo}>
              先体验示例空间 <ArrowRight size={17} />
            </Button>
          </div>
        ) : (
          <form className='auth-form' onSubmit={submit}>
            <div className='auth-form-kicker'>
              <span className='auth-step'>01</span>
              <span>
                {recovery
                  ? '恢复访问'
                  : setup
                    ? '开启你的账号空间'
                    : '继续你的数字日常'}
              </span>
            </div>
            <span className='auth-icon'>
              {recovery ? <FileKey2 size={28} /> : <KeyRound size={28} />}
            </span>
            <h2>
              {recovery
                ? '找回你的账号空间'
                : setup
                  ? '创建你的私密空间'
                  : '欢迎回来'}
            </h2>
            <p>
              {recovery
                ? '使用恢复密钥设置新的主密码。'
                : setup
                  ? '设置一个主密码，开始整理你的账号。'
                  : '输入主密码，解锁你的账号与记录。'}
            </p>
            {recovery ? (
              <TextField
                label='恢复密钥'
                value={recoveryInput}
                onChange={(e) => setRecoveryInput(e.target.value)}
                required
                autoComplete='off'
                spellCheck={false}
                placeholder='创建空间时保存的恢复密钥'
              />
            ) : (
              <TextField
                label='用户名'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                maxLength={64}
                autoComplete='username'
                autoCapitalize='none'
              />
            )}
            {setup && vault.requiresSetupToken && (
              <TextField
                label='初始化令牌'
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                required
                autoComplete='off'
                hint='在服务器执行 docker compose exec app cat /app/data/setup-token 获取。仅首次创建需要。'
              />
            )}
            <PasswordField
              label={recovery ? '新主密码' : '主密码'}
              value={password}
              onChange={setPassword}
              required
              minLength={setup || recovery ? 12 : undefined}
              autoComplete={
                setup || recovery ? 'new-password' : 'current-password'
              }
              placeholder={
                setup || recovery ? '至少 12 个字符' : '输入你的主密码'
              }
            />
            {(setup || recovery) && (
              <PasswordField
                label='再次输入主密码'
                value={confirm}
                onChange={setConfirm}
                required
              />
            )}
            {needOTP && !setup && !recovery && (
              <TextField
                label='验证器验证码'
                value={otp}
                onChange={(e) =>
                  setOTP(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                inputMode='numeric'
                autoComplete='one-time-code'
                placeholder='6 位动态验证码'
                required
              />
            )}
            {setup && (
              <Disclosure
                className='restore-disclosure'
                title={
                  <>
                    <FileKey2 size={16} /> 从加密备份恢复
                  </>
                }
              >
                <div className='restore-fields'>
                  <BackupPicker
                    filename={backupName}
                    onFile={async (file) => {
                      if (file.size > 12 * 1024 * 1024) {
                        setError('备份文件超过 12 MB')
                        return
                      }
                      setBackup(await file.text())
                      setBackupName(file.name)
                    }}
                  />
                  {backup && (
                    <>
                      <label className='checkbox-row'>
                        <Checkbox
                          checked={backupRecovery}
                          onCheckedChange={(v) => setBackupRecovery(v === true)}
                        />{' '}
                        使用备份对应的恢复密钥
                      </label>
                      <PasswordField
                        label={backupRecovery ? '备份恢复密钥' : '备份原主密码'}
                        value={backupSecret}
                        onChange={setBackupSecret}
                        required
                      />
                    </>
                  )}
                </div>
              </Disclosure>
            )}
            {recovery && (
              <div className='inline-note'>
                恢复后将退出所有设备、重置双重验证，并生成新的恢复密钥。
              </div>
            )}
            {error && (
              <div className='form-error' role='alert'>
                {error}
              </div>
            )}
            <Button
              className='primary-button auth-submit'
              disabled={disabled}
              type='submit'
            >
              {disabled ? (
                <Busy text={setup ? '正在创建加密空间…' : '正在解锁…'} />
              ) : (
                <>
                  {recovery
                    ? '恢复账号空间'
                    : setup
                      ? '创建账号空间'
                      : '解锁账号库'}
                  <ArrowRight size={18} />
                </>
              )}
            </Button>
            {!setup && (
              <Button
                variant='ghost'
                type='button'
                disabled={disabled}
                onClick={() => {
                  setRecovery(!recovery)
                  setError('')
                  setPassword('')
                  setConfirm('')
                }}
              >
                {recovery ? (
                  <>
                    <ArrowLeft size={16} /> 返回登录
                  </>
                ) : (
                  '忘记主密码？使用恢复密钥'
                )}
              </Button>
            )}
            {setup && (
              <div className='auth-safe-note'>
                <ShieldCheck size={15} />
                <span>
                  主密码用于在你的设备上解密。
                  <br />
                  创建后请保存恢复密钥。
                </span>
              </div>
            )}
            <div className='auth-demo'>
              <span>先看看是否适合你</span>
              <Button
                variant='ghost'
                type='button'
                onClick={vault.startDemo}
                disabled={disabled}
              >
                体验示例空间 <ArrowRight size={15} />
              </Button>
            </div>
          </form>
        )}
        <div className='auth-footer'>
          拾钥 KEYFOLIO <span>·</span> 你的数字账号空间
        </div>
      </section>
    </div>
  )
}
export function RecoveryDialog() {
  const { recoveryKey, dismissRecovery } = useVault()
  const [saved, setSaved] = useState(false)
  if (!recoveryKey) return null
  return (
    <Dialog open>
      <DialogContent
        className='vault-dialog recovery-dialog'
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className='dialog-title-icon'>
            <FileKey2 size={24} /> 保存你的恢复密钥
          </DialogTitle>
          <DialogDescription>
            忘记主密码或丢失验证器时，可用它恢复这个账号空间。请保存在另一处安全的位置。
          </DialogDescription>
        </DialogHeader>
        <code className='recovery-code'>{recoveryKey}</code>
        <div className='button-row'>
          <Button
            variant='outline'
            onClick={() => void copyValue(recoveryKey, '恢复密钥')}
          >
            复制密钥
          </Button>
          <Button
            variant='outline'
            onClick={() =>
              downloadText(
                `拾钥恢复密钥\n\n${recoveryKey}\n\n生成时间：${new Date().toLocaleString('zh-CN')}\n请妥善保管。恢复密钥可以解锁对应的账号备份；重置主密码后请保存新密钥。`,
                '拾钥-恢复密钥.txt',
                'text/plain'
              )
            }
          >
            <Download size={17} /> 下载保存
          </Button>
        </div>
        <label className='checkbox-row'>
          <Checkbox
            checked={saved}
            onCheckedChange={(v) => setSaved(v === true)}
          />{' '}
          我已将恢复密钥保存在安全的位置
        </label>
        <Button
          className='primary-button'
          disabled={!saved}
          onClick={() => {
            dismissRecovery()
            setSaved(false)
          }}
        >
          <Check size={17} /> 进入账号空间
        </Button>
      </DialogContent>
    </Dialog>
  )
}
