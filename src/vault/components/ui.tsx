import { type ReactNode } from 'react'
import {
  Cloud,
  Code2,
  Copy,
  CreditCard,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  Search,
} from 'lucide-react'
import {
  siAlibabacloud,
  siCloudflare,
  siDocker,
  siFigma,
  siGithub,
  siGitlab,
  siGmail,
  siNotion,
  siStripe,
  siWechat,
  siXiaohongshu,
  type SimpleIcon,
} from 'simple-icons'
import { Button } from '@/components/ui/button'
import { canonicalPlatform } from '../lib/ai-local'
import { copyValue } from '../lib/clipboard'
import { type Account } from '../lib/model'

export function Brand() {
  return (
    <div className='brand'>
      <span className='brand-symbol'>
        <KeyRound size={25} strokeWidth={1.8} />
      </span>
      <div>
        <strong>
          拾钥<span className='brand-dot'>.</span>
        </strong>
        <span className='brand-caption'>KEYFOLIO</span>
      </div>
    </div>
  )
}
export function PlatformIcon({
  account,
  small = false,
}: {
  account: Pick<Account, 'category' | 'platform'>
  small?: boolean
}) {
  const brands: Record<string, SimpleIcon> = {
    github: siGithub,
    gitlab: siGitlab,
    figma: siFigma,
    notion: siNotion,
    stripe: siStripe,
    docker: siDocker,
    cloudflare: siCloudflare,
    gmail: siGmail,
    阿里云: siAlibabacloud,
    微信公众平台: siWechat,
    微信: siWechat,
    小红书: siXiaohongshu,
  }
  const platform = canonicalPlatform(account.platform).toLowerCase()
  const brand = brands[platform]
  if (brand)
    return (
      <span
        className={`platform-icon brand-platform brand-${brand.slug} ${small ? 'small' : ''}`}
      >
        <svg
          viewBox='0 0 24 24'
          width={small ? 18 : 25}
          height={small ? 18 : 25}
          role='img'
          aria-label={brand.title}
        >
          <path d={brand.path} fill='currentColor' />
        </svg>
      </span>
    )
  if (platform.includes('腾讯云'))
    return (
      <span
        className={`platform-icon blue platform-monogram ${small ? 'small' : ''}`}
        aria-label='腾讯云'
      >
        腾
      </span>
    )
  const Icon =
    account.category === '云服务'
      ? Cloud
      : account.category === '开发工具'
        ? Code2
        : account.category === '支付金融'
          ? CreditCard
          : Fingerprint
  const tones: Record<string, string> = {
    云服务: 'orange',
    开发工具: 'ink',
    效率工具: 'purple',
    支付金融: 'blue',
    社交媒体: 'green',
  }
  return (
    <span
      className={`platform-icon ${tones[account.category] || 'green'} ${small ? 'small' : ''}`}
    >
      <Icon size={small ? 18 : 25} strokeWidth={1.7} />
    </span>
  )
}
export function PageHeading({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children?: ReactNode
}) {
  return (
    <div className='page-heading'>
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  )
}
export function EmptyState({
  title,
  text,
  children,
}: {
  title: string
  text: string
  children?: ReactNode
}) {
  return (
    <div className='empty-state'>
      <Search size={32} />
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  )
}
export function Busy({ text = '正在处理…' }: { text?: string }) {
  return (
    <span className='busy-label'>
      <LoaderCircle size={17} className='animate-spin' />
      {text}
    </span>
  )
}
export function CopyButton({
  value,
  label = '账号',
  disabled = false,
}: {
  value: string
  label?: string
  disabled?: boolean
}) {
  return (
    <Button
      variant='ghost'
      type='button'
      className='copy-button'
      aria-label={`复制${label}`}
      title={`复制${label}`}
      disabled={disabled}
      onClick={() => void copyValue(value, label)}
    >
      <Copy size={15} />
      <span>复制{label}</span>
    </Button>
  )
}
export function ActionButton({
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button className='primary-button' {...props}>
      {children}
    </Button>
  )
}
