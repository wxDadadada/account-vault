import { useEffect, useState } from 'react'
import { DatabaseBackup, Download, FileKey2, Upload } from 'lucide-react'
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
import { api } from '../lib/api'
import { readBackup } from '../lib/crypto'
import { mergeBackup } from '../lib/domain'
import { type VaultData } from '../lib/model'
import { useVault } from '../state/context'
import { BackupPicker } from './controls'
import { PasswordField } from './fields'
import { Busy } from './ui'

export function BackupSettings() {
  const { exportBackup, demo } = useVault()
  const [lastBackup, setLastBackup] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  useEffect(() => {
    if (!demo)
      void api<{ lastBackupAt: string | null }>('/security')
        .then((v) => setLastBackup(v.lastBackupAt))
        .catch(() => setError('备份状态加载失败'))
  }, [demo])
  async function backup() {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ lastBackupAt: string }>('/backup', {})
      setLastBackup(result.lastBackupAt)
      toast.success('服务器备份已生成')
    } catch (e) {
      setError(e instanceof Error ? e.message : '备份失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className='settings-card'>
      <div className='settings-card-heading'>
        <span className='settings-icon'>
          <DatabaseBackup size={20} />
        </span>
        <div>
          <h2>备份与恢复</h2>
          <p>把数据的另一份副本留在手里。</p>
        </div>
      </div>
      <div className='backup-status'>
        <FileKey2 size={27} />
        <div>
          <strong>加密备份文件</strong>
          <p>包含账号、主体、配置与历史记录</p>
        </div>
      </div>
      <div className='button-row'>
        <Button
          variant='outline'
          disabled={demo}
          onClick={() =>
            void exportBackup()
              .then(() => toast.success('已导出加密备份'))
              .catch((e) => setError(e.message))
          }
        >
          <Download size={16} />
          导出备份
        </Button>
        <Button
          variant='outline'
          disabled={demo}
          onClick={() => setImporting(true)}
        >
          <Upload size={16} />
          导入备份
        </Button>
      </div>
      <div className='server-backup-row'>
        <div>
          <strong>服务器自动备份</strong>
          <span>
            {lastBackup
              ? `最近：${new Date(lastBackup).toLocaleString('zh-CN')}`
              : '首次备份尚未生成'}
          </span>
        </div>
        <Button
          variant='ghost'
          disabled={busy || demo}
          onClick={() => void backup()}
        >
          {busy ? <Busy /> : '立即备份'}
        </Button>
      </div>
      <div className='inline-note'>
        服务器每天保留一份快照，保留最近 14
        份。导出的加密文件可在新安装的拾钥中完整恢复；恢复密钥请单独保存。
      </div>
      {error && (
        <div className='form-error' role='alert'>
          {error}
        </div>
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </section>
  )
}
function ImportDialog({ onClose }: { onClose: () => void }) {
  const { data, commit, busy } = useVault()
  const [text, setText] = useState('')
  const [filename, setFilename] = useState('')
  const [secret, setSecret] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [imported, setImported] = useState<VaultData | null>(null)
  const [preview, setPreview] = useState<{
    added: number
    skipped: number
  } | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  async function inspect() {
    setWorking(true)
    setError('')
    let value: VaultData
    try {
      value = await readBackup(text, secret, useRecovery)
    } catch {
      setError('无法读取或解密此备份，请检查文件及对应的主密码或恢复密钥')
      setWorking(false)
      return
    }
    try {
      const result = mergeBackup(structuredClone(data!), value)
      setImported(value)
      setPreview({ added: result.added, skipped: result.skipped })
      setSecret('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法合并此备份')
    } finally {
      setWorking(false)
    }
  }
  async function finish() {
    if (!imported) return
    setError('')
    try {
      await commit((d) => mergeBackup(d, imported).data)
      toast.success('备份中的账号已合并导入')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败')
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy && !working && onClose()}
    >
      <DialogContent className='vault-dialog'>
        <DialogHeader>
          <DialogTitle>导入加密备份</DialogTitle>
          <DialogDescription>
            合并不重复的账号及其历史，保留当前空间的 AI
            配置与主密码。主体名称或别名冲突时会提示处理。
          </DialogDescription>
        </DialogHeader>
        {!imported ? (
          <div className='editor-form'>
            <BackupPicker
              filename={filename}
              onFile={async (file) => {
                if (file.size > 12 * 1024 * 1024) {
                  setError('文件超过 12 MB')
                  return
                }
                setText(await file.text())
                setFilename(file.name)
                setError('')
              }}
            />
            <label className='checkbox-row'>
              <Checkbox
                checked={useRecovery}
                onCheckedChange={(v) => setUseRecovery(v === true)}
              />{' '}
              使用恢复密钥解密
            </label>
            <PasswordField
              label={useRecovery ? '备份恢复密钥' : '备份原主密码'}
              value={secret}
              onChange={setSecret}
            />
            <Button
              className='primary-button'
              disabled={!text || !secret || working}
              onClick={() => void inspect()}
            >
              {working ? <Busy text='正在本地解密…' /> : '查看导入预览'}
            </Button>
          </div>
        ) : (
          <>
            <div className='import-preview'>
              <div>
                <strong>{preview?.added}</strong>
                <span>新增账号</span>
              </div>
              <div>
                <strong>{preview?.skipped}</strong>
                <span>重复跳过</span>
              </div>
            </div>
            <div className='inline-note'>
              相同主体、平台、账号和登录地址视为重复，不覆盖已有记录。导入历史仍受当前保留数量限制。
            </div>
            <Button
              className='primary-button'
              disabled={busy}
              onClick={() => void finish()}
            >
              {busy ? <Busy text='正在加密保存…' /> : '确认合并导入'}
            </Button>
          </>
        )}
        {error && (
          <div className='form-error' role='alert'>
            {error}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
