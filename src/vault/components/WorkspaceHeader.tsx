import { Link } from '@tanstack/react-router'
import {
  Building2,
  CircleHelp,
  History,
  KeyRound,
  LockKeyhole,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Brand } from './ui'

const pages = [
  { to: '/', name: '账号库', short: '账号库', icon: KeyRound },
  { to: '/subjects', name: '主体与分类', short: '主体', icon: Building2 },
  { to: '/history', name: '变更记录', short: '动态', icon: History },
  { to: '/settings', name: '设置', short: '设置', icon: Settings2 },
]

export function WorkspaceHeader({
  pathname,
  username,
  demo,
  busy,
  onSync,
  onHelp,
  onLock,
  onAdd,
}: {
  pathname: string
  username: string
  demo: boolean
  busy: boolean
  onSync: () => void
  onHelp: () => void
  onLock: () => void
  onAdd: () => void
}) {
  return (
    <>
      <header className='workspace-header'>
        <Brand />
        <nav className='workspace-pages' aria-label='主要导航'>
          {pages.map((page) => (
            <Button key={page.to} variant='ghost' asChild>
              <Link
                to={page.to}
                aria-current={pathname === page.to ? 'page' : undefined}
              >
                <page.icon size={17} />
                <span>{page.name}</span>
              </Link>
            </Button>
          ))}
        </nav>
        <div className='workspace-actions'>
          <span className='workspace-save-state' role='status'>
            <ShieldCheck size={14} />
            {demo ? '示例空间' : busy ? '加密保存中' : '已解锁'}
          </span>
          <Button
            variant='ghost'
            size='icon'
            aria-label='同步最新内容'
            title='同步最新内容'
            disabled={busy}
            onClick={onSync}
          >
            <RefreshCw
              size={17}
              className={busy ? 'animate-spin' : undefined}
            />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='workspace-help'
            aria-label='使用说明'
            onClick={onHelp}
          >
            <CircleHelp size={18} />
          </Button>
          <Button
            variant='ghost'
            className='workspace-user'
            aria-label={demo ? '退出体验' : '锁定账号库'}
            title={demo ? '退出示例体验' : `${username} · 退出登录并锁定账号库`}
            onClick={onLock}
          >
            <span>{demo ? 'K' : username.slice(0, 1).toUpperCase()}</span>
            <LockKeyhole size={15} />
          </Button>
        </div>
      </header>
      <nav className='workspace-mobile-nav' aria-label='手机主要导航'>
        {pages.slice(0, 2).map((page) => (
          <Button key={page.to} variant='ghost' asChild>
            <Link
              to={page.to}
              aria-current={pathname === page.to ? 'page' : undefined}
            >
              <page.icon size={20} />
              <span>{page.short}</span>
            </Link>
          </Button>
        ))}
        <Button
          variant='ghost'
          className='workspace-create'
          aria-label='添加账号'
          onClick={onAdd}
        >
          <Plus size={23} />
          <span>新增</span>
        </Button>
        {pages.slice(2).map((page) => (
          <Button key={page.to} variant='ghost' asChild>
            <Link
              to={page.to}
              aria-current={pathname === page.to ? 'page' : undefined}
            >
              <page.icon size={20} />
              <span>{page.short}</span>
            </Link>
          </Button>
        ))}
      </nav>
    </>
  )
}
