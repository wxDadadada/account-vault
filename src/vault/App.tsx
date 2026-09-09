import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { History, KeyRound, Sparkles } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { useTheme } from '@/context/theme-provider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Confirm, type Confirmation } from './components/Confirm'
import { WorkspaceHeader } from './components/WorkspaceHeader'
import { Busy } from './components/ui'
import { deleteAccount, saveAccount } from './lib/domain'
import { type Account, type Change } from './lib/model'
import { registerCaptureTool, type ModelContext } from './lib/webmcp'
import { Accounts } from './pages/Accounts'
import { AuthScreen, RecoveryDialog } from './pages/Auth'
import { useVault } from './state/context'

const AccountEditor = lazy(() =>
  import('./components/AccountEditor').then((m) => ({
    default: m.AccountEditor,
  }))
)
const AccountDetail = lazy(() =>
  import('./components/AccountDetail').then((m) => ({
    default: m.AccountDetail,
  }))
)
const AIComposer = lazy(() =>
  import('./components/AIComposer').then((m) => ({ default: m.AIComposer }))
)
const SubjectsPage = lazy(() =>
  import('./pages/Subjects').then((m) => ({ default: m.SubjectsPage }))
)
const HistoryPage = lazy(() =>
  import('./pages/History').then((m) => ({ default: m.HistoryPage }))
)
const SettingsPage = lazy(() =>
  import('./pages/Settings').then((m) => ({ default: m.SettingsPage }))
)
export function VaultApp() {
  const { phase, data } = useVault()
  const { resolvedTheme } = useTheme()
  return (
    <>
      {phase === 'open' && data ? <UnlockedApp /> : <AuthScreen key={phase} />}
      <Toaster
        theme={resolvedTheme}
        position='top-center'
        richColors
        closeButton
      />
    </>
  )
}
function UnlockedApp() {
  const vault = useVault()
  const { demo, busy } = vault
  const data = vault.data!
  const [subject, setSubject] = useState('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Account | null | undefined>(undefined)
  const [composer, setComposer] = useState<{
    mode: 'capture' | 'search'
    text?: string
  } | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [help, setHelp] = useState(false)
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const navigate = useNavigate()
  const selected = data?.accounts.find((a) => a.id === selectedId)
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  useEffect(() => {
    try {
      return registerCaptureTool(
        (document as Document & { modelContext?: ModelContext }).modelContext,
        (text) => setComposer({ mode: 'capture', text })
      )
    } catch {
      return
    }
  }, [])
  function filterSubject(id: string) {
    setSubject(id)
    setQuery('')
    void navigate({ to: '/' })
  }
  const notifyError = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : '操作失败，请重试')
  function askExit() {
    setConfirmation({
      title: demo ? '退出示例体验？' : '退出登录并锁定账号库？',
      description: demo
        ? '本次示例中的修改会被清除。退出后可以创建或解锁自己的账号空间。'
        : `已保存的账号会保留，未保存的编辑和聊天草稿会被清除。同一浏览器中的其他页面也会锁定，再次进入需要主密码。${busy ? '当前操作尚未结束，退出后请重新进入核对本次修改是否保存成功。' : ''}`,
      label: demo ? '确认退出体验' : '确认退出',
      cancelLabel: '继续使用',
      action: vault.lock,
    })
  }
  function favorite(account: Account) {
    void vault
      .commit((d) =>
        saveAccount(
          d,
          { ...account, favorite: !account.favorite },
          'manual',
          account
        )
      )
      .catch(notifyError)
  }
  function askDelete(account: Account) {
    setConfirmation({
      title: `删除「${account.platform}」账号？`,
      description: `账号 ${account.username} 将移入回收站，账号和历史记录保留，可以随后恢复。`,
      label: '删除账号',
      danger: true,
      action: async () => {
        await vault.commit((d) => deleteAccount(d, account))
        setSelectedId(null)
        toast.success('账号已删除，历史记录已保留')
      },
    })
  }
  function askRestore(change: Change) {
    const target = change.after ?? change.before
    if (!target) return
    const current = data?.accounts.find((a) => a.id === target.id) ?? null
    setConfirmation({
      title: `恢复「${target.platform}」的这个版本？`,
      description:
        '将用这个历史版本更新账号库并生成一条恢复记录。第三方平台上的实际账号信息需要你自行同步修改。',
      label: '恢复记录',
      action: async () => {
        await vault.commit((d) =>
          saveAccount(d, target, 'manual', current, 'restore')
        )
        toast.success('历史版本已恢复')
      },
    })
  }
  return (
    <div className='app-frame'>
      <a className='skip-link' href='#main'>
        跳转到主要内容
      </a>
      <WorkspaceHeader
        pathname={pathname}
        username={vault.profile?.username ?? ''}
        demo={demo}
        busy={busy}
        onSync={() => void vault.sync().catch(notifyError)}
        onHelp={() => setHelp(true)}
        onLock={askExit}
        onAdd={() => setEditing(null)}
      />
      <div className='workspace-body'>
        <main id='main' className='workspace-content'>
          <Suspense
            fallback={
              <div className='loading-card'>
                <Busy text='正在打开…' />
              </div>
            }
          >
            {vault.conflict && (
              <div className='conflict-banner' role='alert'>
                <span>
                  其他设备有更新。本次修改尚未保存，请同步后重新核对。
                </span>
                <Button
                  variant='outline'
                  disabled={busy}
                  onClick={() => void vault.sync().catch(notifyError)}
                >
                  同步最新内容
                </Button>
              </div>
            )}
            {pathname === '/' && (
              <Accounts
                data={data}
                subject={subject}
                setSubject={setSubject}
                onSelect={(a) => setSelectedId(a.id)}
                onAdd={() => setEditing(null)}
                onAI={(text) => setComposer({ mode: 'capture', text })}
                onEdit={(account) => setEditing(account)}
                onAISearch={() => setComposer({ mode: 'search' })}
                onHistory={() => void navigate({ to: '/history' })}
                onFavorite={favorite}
                demo={demo}
                query={query}
                setQuery={setQuery}
              />
            )}
            {pathname === '/subjects' && (
              <SubjectsPage
                onSelect={filterSubject}
                onTag={(tag) => {
                  setSubject('all')
                  setQuery(tag)
                  void navigate({ to: '/' })
                }}
              />
            )}
            {pathname === '/history' && <HistoryPage onRestore={askRestore} />}
            {pathname === '/settings' && <SettingsPage />}
          </Suspense>
        </main>
      </div>
      <Suspense fallback={null}>
        {selected && (
          <AccountDetail
            key={selected.id}
            account={selected}
            onClose={() => setSelectedId(null)}
            onEdit={() => {
              setEditing(selected)
              setSelectedId(null)
            }}
            onDelete={() => askDelete(selected)}
            onRestore={askRestore}
          />
        )}
        {editing !== undefined && (
          <AccountEditor
            key={editing?.id ?? 'new'}
            initial={editing}
            defaultSubject={subject}
            onClose={() => setEditing(undefined)}
          />
        )}
        {composer && (
          <AIComposer
            initialMode={composer.mode}
            initialText={composer.text}
            defaultSubject={subject}
            suspended={!!selected || editing !== undefined}
            onClose={() => setComposer(null)}
            onSelect={(a) => setSelectedId(a.id)}
          />
        )}
      </Suspense>
      {confirmation && (
        <Confirm value={confirmation} onClose={() => setConfirmation(null)} />
      )}
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className='vault-dialog'>
          <DialogHeader>
            <DialogTitle>认识你的账号空间</DialogTitle>
            <DialogDescription>三个动作，把账号整理清楚。</DialogDescription>
          </DialogHeader>
          <div className='help-items'>
            <div>
              <KeyRound size={22} />
              <section>
                <strong>记下来</strong>
                <p>
                  点“添加账号”手动填写，或让 AI
                  把文字整理成卡片。密码填在独立安全字段中。
                </p>
              </section>
            </div>
            <div>
              <SearchIcon />
              <section>
                <strong>找出来</strong>
                <p>
                  按主体、分类或关键词筛选。搜索旁的星光按钮支持自然语言查询。
                </p>
              </section>
            </div>
            <div>
              <History size={22} />
              <section>
                <strong>更新一下</strong>
                <p>
                  每次编辑会生成变更记录，可以查看旧版本或恢复。多设备使用时可点同步获取最新内容。
                </p>
              </section>
            </div>
          </div>
          <Button className='primary-button' onClick={() => setHelp(false)}>
            知道了
          </Button>
        </DialogContent>
      </Dialog>
      <RecoveryDialog />
    </div>
  )
}
function SearchIcon() {
  return <Sparkles size={22} />
}
