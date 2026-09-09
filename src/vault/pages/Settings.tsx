import { useState, type FormEvent } from 'react'
import {
  ExternalLink,
  Monitor,
  Moon,
  Save,
  ShieldCheck,
  Sparkles,
  Sun,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTheme } from '@/context/theme-provider'
import { Button } from '@/components/ui/button'
import { BackupSettings } from '../components/BackupSettings'
import { SecuritySettings } from '../components/SecuritySettings'
import { FieldSelect, FieldOption } from '../components/controls'
import { Field, PasswordField, TextField } from '../components/fields'
import { Busy, PageHeading } from '../components/ui'
import { api } from '../lib/api'
import { useVault } from '../state/context'

export function SettingsPage() {
  const { data, commit, busy, demo } = useVault()
  const { theme, setTheme } = useTheme()
  const [ai, setAI] = useState(data!.ai)
  const [lockMinutes, setLockMinutes] = useState(
    data!.preferences.autoLockMinutes
  )
  const [historyLimit, setHistoryLimit] = useState(
    data!.preferences.historyLimit
  )
  const [testing, setTesting] = useState(false)
  const [aiError, setAIError] = useState('')
  const [prefsError, setPrefsError] = useState('')
  if (!data) return null
  async function saveAI(e: FormEvent) {
    e.preventDefault()
    setAIError('')
    try {
      if (!ai.baseUrl.startsWith('https://') || !ai.model.trim())
        throw new Error('请填写 HTTPS 接口地址和模型名称')
      await commit((d) => ({
        ...d,
        ai: {
          baseUrl: ai.baseUrl.trim().replace(/\/$/, ''),
          model: ai.model.trim(),
          apiKey: ai.apiKey.trim(),
        },
      }))
      toast.success('AI 配置已加密保存')
    } catch (e) {
      setAIError(e instanceof Error ? e.message : '保存失败')
    }
  }
  async function testAI() {
    setTesting(true)
    setAIError('')
    try {
      if (demo) throw new Error('请在正式账号空间中配置并连接 AI 服务')
      if (!ai.apiKey.trim()) throw new Error('请先填写 API Key')
      await api('/ai/parse', {
        mode: 'capture',
        text: '记录一个示例平台的账号 test@example.invalid，分类为其他。',
        categories: ['其他'],
        config: ai,
      })
      toast.success('连接成功，模型可以正常整理账号')
    } catch (e) {
      setAIError(e instanceof Error ? e.message : '连接失败')
    } finally {
      setTesting(false)
    }
  }
  async function savePreferences(e: FormEvent) {
    e.preventDefault()
    setPrefsError('')
    try {
      await commit((d) => ({
        ...d,
        preferences: { autoLockMinutes: lockMinutes, historyLimit },
      }))
      toast.success('偏好已保存')
    } catch (e) {
      setPrefsError(e instanceof Error ? e.message : '保存失败')
    }
  }
  return (
    <>
      <PageHeading title='设置' subtitle='让账号空间按你的习惯工作。' />
      <div className='settings-workspace'>
        <nav className='settings-jump-nav' aria-label='设置分组'>
          {[
            ['security', '登录与安全'],
            ['backup', '备份与恢复'],
            ['appearance', '外观与偏好'],
            ['ai', 'AI 整理助手'],
          ].map(([id, label]) => (
            <Button asChild variant='outline' key={id}>
              <a href={'#settings-' + id}>{label}</a>
            </Button>
          ))}
        </nav>
        <div className='settings-panels'>
          <div id='settings-security'>
            <SecuritySettings />
          </div>
          <div id='settings-backup'>
            <BackupSettings />
          </div>
          <div id='settings-appearance'>
            <section className='settings-card'>
              <div className='settings-card-heading'>
                <span className='settings-icon'>
                  <Monitor size={20} />
                </span>
                <div>
                  <h2>外观与偏好</h2>
                  <p>适合你的使用节奏。</p>
                </div>
              </div>
              <div className='theme-options'>
                {[
                  { value: 'light', label: '浅色', icon: Sun },
                  { value: 'dark', label: '深色', icon: Moon },
                  { value: 'system', label: '跟随系统', icon: Monitor },
                ].map((t) => (
                  <Button
                    variant='ghost'
                    type='button'
                    key={t.value}
                    className={theme === t.value ? 'active' : ''}
                    aria-pressed={theme === t.value}
                    onClick={() =>
                      setTheme(t.value as 'light' | 'dark' | 'system')
                    }
                  >
                    <t.icon size={21} />
                    <span>{t.label}</span>
                  </Button>
                ))}
              </div>
              <form onSubmit={savePreferences} className='editor-form'>
                <Field label='闲置后自动锁定'>
                  <FieldSelect
                    aria-label='自动锁定时间'
                    value={lockMinutes}
                    onValueChange={(selectedValue) =>
                      setLockMinutes(Number(selectedValue))
                    }
                  >
                    {[1, 5, 10, 15, 30, 60].map((n) => (
                      <FieldOption key={n} value={n}>
                        {n} 分钟
                      </FieldOption>
                    ))}
                  </FieldSelect>
                </Field>
                <Field
                  label='每个账号保留的变更数量'
                  hint='减少保留数量会在保存后清理较早的历史，包括旧密码。'
                >
                  <FieldSelect
                    aria-label='历史保留数量'
                    value={historyLimit}
                    onValueChange={(selectedValue) =>
                      setHistoryLimit(Number(selectedValue))
                    }
                  >
                    {[5, 10, 20, 50, 100].map((n) => (
                      <FieldOption key={n} value={n}>
                        最近 {n} 条
                      </FieldOption>
                    ))}
                  </FieldSelect>
                </Field>
                {prefsError && (
                  <div className='form-error' role='alert'>
                    {prefsError}
                  </div>
                )}
                <Button type='submit' variant='outline' disabled={busy}>
                  保存偏好
                </Button>
              </form>
              <div className='mobile-install-note'>
                <Monitor size={18} />
                <div>
                  <strong>像 App 一样使用</strong>
                  <p>
                    手机浏览器中选择“添加到主屏幕”，即可从桌面打开。访问服务器时需要
                    HTTPS。
                  </p>
                </div>
              </div>
            </section>
          </div>
          <div id='settings-ai'>
            <section className='settings-card'>
              <div className='settings-card-heading'>
                <span className='settings-icon'>
                  <Sparkles size={20} />
                </span>
                <div>
                  <h2>AI 整理助手</h2>
                  <p>按需调用你自己的模型服务。</p>
                </div>
                <span
                  className={`settings-badge ${data.ai.apiKey ? 'enabled' : ''}`}
                >
                  {data.ai.apiKey ? '已配置' : '未配置'}
                </span>
              </div>
              <form className='editor-form' onSubmit={saveAI}>
                <div className='provider-buttons'>
                  {[
                    {
                      label: 'DeepSeek',
                      baseUrl: 'https://api.deepseek.com',
                      model: 'deepseek-v4-flash',
                    },
                    {
                      label: 'Moonshot',
                      baseUrl: 'https://api.moonshot.cn/v1',
                      model: 'moonshot-v1-8k',
                    },
                  ].map((p) => (
                    <Button
                      variant='ghost'
                      type='button'
                      key={p.label}
                      onClick={() =>
                        setAI({
                          ...ai,
                          baseUrl: p.baseUrl,
                          model: p.model,
                          apiKey: '',
                        })
                      }
                      className={
                        ai.baseUrl.startsWith(p.baseUrl) ? 'active' : ''
                      }
                      aria-pressed={ai.baseUrl.startsWith(p.baseUrl)}
                    >
                      {p.label}
                    </Button>
                  ))}
                  <span>也可填写兼容接口</span>
                </div>
                <TextField
                  label='接口地址'
                  value={ai.baseUrl}
                  onChange={(e) => setAI({ ...ai, baseUrl: e.target.value })}
                  required
                  type='url'
                  maxLength={2048}
                  placeholder='https://api.example.com/v1'
                />
                <TextField
                  label='模型名称'
                  value={ai.model}
                  onChange={(e) => setAI({ ...ai, model: e.target.value })}
                  required
                  maxLength={200}
                />
                <PasswordField
                  label='API Key'
                  value={ai.apiKey}
                  onChange={(apiKey) => setAI({ ...ai, apiKey })}
                  placeholder='粘贴你的模型服务密钥'
                />
                <div className='inline-note'>
                  密钥随账号库加密保存；调用时经本机服务转发。密码字段不参与 AI
                  整理。测试连接会发送一条示例请求。
                </div>
                {aiError && (
                  <div className='form-error' role='alert'>
                    {aiError}
                  </div>
                )}
                <div className='form-actions'>
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => void testAI()}
                    disabled={testing || busy}
                  >
                    {testing ? <Busy text='连接中…' /> : '测试连接'}
                  </Button>
                  <Button
                    type='submit'
                    className='primary-button'
                    disabled={busy || testing}
                  >
                    <Save size={16} />
                    保存配置
                  </Button>
                </div>
              </form>
            </section>
          </div>
        </div>
      </div>
      <div className='about-line'>
        <span>
          <ShieldCheck size={15} /> 拾钥 Keyfolio · 0.2.0
        </span>
        <a
          href='https://github.com/satnaing/shadcn-admin'
          target='_blank'
          rel='noopener noreferrer'
        >
          基于 shadcn-admin <ExternalLink size={12} />
        </a>
      </div>
    </>
  )
}
