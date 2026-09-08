import { useState } from 'react'
import {
  ArrowUpRight,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  History,
  Pencil,
  Star,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { copyValue } from '../lib/clipboard'
import { accountIssues, expiryLabel } from '../lib/collection'
import {
  type Account,
  type Change,
  displayDate,
  fieldNames,
  statusNames,
} from '../lib/model'
import { ChangeDiff } from '../pages/History'
import { useVault } from '../state/context'
import { AccountSecrets } from './AccountSecrets'
import { PlatformIcon } from './ui'

export function AccountDetail({
  account,
  onClose,
  onEdit,
  onDelete,
  onRestore,
}: {
  account: Account
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onRestore: (change: Change) => void
}) {
  const { data } = useVault()
  const [tab, setTab] = useState('details')
  const [shown, setShown] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const owner = data?.subjects.find((s) => s.id === account.subjectId)
  const changes = data?.changes.filter((c) => c.accountId === account.id) ?? []
  const reveal = () => {
    setShown(!shown)
    if (!shown) setTimeout(() => setShown(false), 30000)
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='vault-dialog detail-dialog'>
        <DialogHeader>
          <div className='detail-heading'>
            <PlatformIcon account={account} />
            <div>
              <DialogTitle>
                {account.alias || account.platform}{' '}
                {account.favorite && (
                  <Star size={16} fill='currentColor' className='detail-star' />
                )}
              </DialogTitle>
              <DialogDescription>
                {account.alias && (
                  <>
                    {account.platform}
                    <span className='separator-dot'>·</span>
                  </>
                )}
                {owner?.name ?? '未分配主体'}
                <span className='separator-dot'>·</span>
                {account.category}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className='detail-tabs'>
          <Button
            variant='ghost'
            type='button'
            className={tab === 'details' ? 'active' : ''}
            aria-pressed={tab === 'details'}
            onClick={() => setTab('details')}
          >
            账号信息
          </Button>
          <Button
            variant='ghost'
            type='button'
            className={tab === 'history' ? 'active' : ''}
            aria-pressed={tab === 'history'}
            onClick={() => setTab('history')}
          >
            <History size={15} /> 变更记录 <span>{changes.length}</span>
          </Button>
        </div>
        {tab === 'details' ? (
          <>
            <div className='credential-block'>
              <div>
                <span>账号 / 登录标识</span>
                <strong>{account.username}</strong>
              </div>
              <Button
                variant='ghost'
                size='icon'
                aria-label='复制账号'
                onClick={() => void copyValue(account.username, '账号')}
              >
                <Copy size={17} />
              </Button>
            </div>
            <div className='credential-block password-block'>
              <div>
                <span>密码</span>
                <strong
                  className={shown ? 'revealed-password' : 'masked-password'}
                >
                  {account.password
                    ? shown
                      ? account.password
                      : '••••••••••••'
                    : '尚未记录'}
                </strong>
              </div>
              {account.password && (
                <div className='credential-actions'>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={shown ? '隐藏密码' : '显示密码'}
                    onClick={reveal}
                  >
                    {shown ? <EyeOff size={17} /> : <Eye size={17} />}
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label='复制密码'
                    onClick={() => void copyValue(account.password, '密码')}
                  >
                    <Copy size={17} />
                  </Button>
                </div>
              )}
            </div>
            <dl className='detail-metadata'>
              {account.expiresOn && (
                <div>
                  <dt>到期日期</dt>
                  <dd className='expiry-detail'>
                    {account.expiresOn}
                    <small>
                      {expiryLabel(account)} · 提前 {account.reminderDays ?? 7}{' '}
                      天提醒
                    </small>
                  </dd>
                </div>
              )}
              <div>
                <dt>所属主体</dt>
                <dd>
                  <span className={`subject-dot ${owner?.color}`} />
                  {owner?.name ?? '未分配'}
                </dd>
              </div>
              <div>
                <dt>登录方式</dt>
                <dd>{account.loginMethod || '未填写'}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>
                  <span className={`status-dot ${account.status}`} />
                  {statusNames[account.status]}
                </dd>
              </div>
              <div>
                <dt>绑定邮箱</dt>
                <dd>{account.email || '未填写'}</dd>
              </div>
              <div>
                <dt>绑定手机</dt>
                <dd>{account.phone || '未填写'}</dd>
              </div>
              <div>
                <dt>登录地址</dt>
                <dd>
                  {account.url ? (
                    <a
                      href={account.url}
                      target='_blank'
                      rel='noopener noreferrer'
                    >
                      {new URL(account.url).hostname} <ArrowUpRight size={14} />
                    </a>
                  ) : (
                    '未填写'
                  )}
                </dd>
              </div>
            </dl>
            <AccountSecrets account={account} />
            {!!accountIssues(data?.accounts ?? []).get(account.id)?.length && (
              <div className='detail-issues'>
                <strong>待处理事项</strong>
                <ul>
                  {accountIssues(data?.accounts ?? [])
                    .get(account.id)
                    ?.map((issue) => (
                      <li key={issue.type}>{issue.reason}</li>
                    ))}
                </ul>
                <Button variant='outline' size='sm' onClick={onEdit}>
                  编辑并完善
                </Button>
              </div>
            )}
            {account.tags.length > 0 && (
              <div className='detail-tags'>
                {account.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            )}
            {account.notes && (
              <div className='detail-note'>
                <span>备注</span>
                <p>{account.notes}</p>
              </div>
            )}
            <div className='detail-dates'>
              <Clock3 size={14} />
              <span>
                创建于 {displayDate(account.createdAt)} · 更新于{' '}
                {displayDate(account.updatedAt, true)}
              </span>
            </div>
            <div className='detail-actions'>
              <Button
                variant='ghost'
                className='danger-ghost'
                onClick={onDelete}
              >
                <Trash2 size={17} /> 删除
              </Button>
              <div>
                {account.url && (
                  <Button variant='outline' asChild>
                    <a
                      href={account.url}
                      target='_blank'
                      rel='noopener noreferrer'
                    >
                      前往平台 <ArrowUpRight size={16} />
                    </a>
                  </Button>
                )}
                <Button className='primary-button' onClick={onEdit}>
                  <Pencil size={16} /> 编辑账号
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className='detail-history'>
            {changes.length ? (
              changes.map((c) => (
                <div className='history-event' key={c.id}>
                  <Button
                    variant='ghost'
                    type='button'
                    className='history-event-title'
                    onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  >
                    <span className='history-bullet' />
                    <div>
                      <strong>
                        {c.action === 'create'
                          ? '新增账号'
                          : c.action === 'delete'
                            ? '删除账号'
                            : c.action === 'restore'
                              ? '恢复版本'
                              : `更新${c.fields.map((f) => fieldNames[f] ?? f).join('、')}`}
                      </strong>
                      <span>
                        {displayDate(c.at, true)} ·{' '}
                        {c.source === 'ai'
                          ? 'AI 录入'
                          : c.source === 'import'
                            ? '备份导入'
                            : '手动修改'}
                      </span>
                    </div>
                  </Button>
                  {expanded === c.id && (
                    <ChangeDiff change={c} onRestore={() => onRestore(c)} />
                  )}
                </div>
              ))
            ) : (
              <p className='field-hint'>还没有变更记录</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
