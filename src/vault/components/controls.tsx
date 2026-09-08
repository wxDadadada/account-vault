import { useId, useRef, type ComponentProps, type ReactNode } from 'react'
import { ChevronDown, FileKey2, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const encodeValue = (value: string | number) => `item:${value}`
export function FieldSelect({
  value,
  onValueChange,
  children,
  className,
  placeholder = '请选择',
  ...props
}: Omit<ComponentProps<typeof SelectTrigger>, 'value' | 'onChange'> & {
  value: string | number
  onValueChange: (value: string) => void
  children: ReactNode
  placeholder?: string
}) {
  return (
    <Select
      value={encodeValue(value)}
      onValueChange={(next) => onValueChange(next.slice(5))}
      disabled={props.disabled}
    >
      <SelectTrigger {...props} className={cn('field-select', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        className='vault-select-content'
        position='popper'
        sideOffset={6}
      >
        {children}
      </SelectContent>
    </Select>
  )
}
export function FieldOption({
  value,
  children,
  ...props
}: Omit<ComponentProps<typeof SelectItem>, 'value'> & {
  value: string | number
}) {
  return (
    <SelectItem {...props} value={encodeValue(value)}>
      {children}
    </SelectItem>
  )
}
export function Disclosure({
  title,
  children,
  className,
  defaultOpen = false,
}: {
  title: ReactNode
  children: ReactNode
  className?: string
  defaultOpen?: boolean
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className={cn('vault-disclosure', className)}
    >
      <CollapsibleTrigger asChild>
        <Button type='button' variant='ghost' className='disclosure-trigger'>
          <span>{title}</span>
          <ChevronDown size={17} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className='disclosure-content'>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
export function BackupPicker({
  label = '选择加密备份',
  filename,
  onFile,
}: {
  label?: string
  filename?: string
  onFile: (file: File) => void | Promise<void>
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className='backup-picker'>
      <Label htmlFor={id}>{label}</Label>
      <Input
        ref={input}
        id={id}
        type='file'
        accept='.json'
        className='sr-only'
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void onFile(file)
          e.target.value = ''
        }}
      />
      <Button
        type='button'
        variant='outline'
        className='backup-file-button'
        onClick={() => input.current?.click()}
      >
        <span className='upload-icon'>
          <FileKey2 size={23} />
        </span>
        <span>
          <strong>{filename || '点击选择备份文件'}</strong>
          <small>拾钥加密备份 · .json · 最大 12 MB</small>
        </span>
        <Upload size={18} />
      </Button>
    </div>
  )
}
