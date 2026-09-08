import { toast } from 'sonner'

export async function copyValue(value: string, label = '内容') {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`${label}已复制`)
  } catch {
    toast.error('无法访问剪贴板，请展开内容后手动复制。')
  }
}
