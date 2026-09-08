import {
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { Eye, EyeOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { generatePassword } from '../lib/crypto'

export function Field({
  label,
  hint,
  error,
  children,
  className = '',
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`form-field ${className}`}>
      <span className='field-label'>{label}</span>
      {children}
      {error && (
        <span className='field-error' role='alert'>
          {error}
        </span>
      )}
      {hint && <span className='field-hint'>{hint}</span>}
    </div>
  )
}
export function TextField({
  label,
  hint,
  error,
  className,
  ...props
}: ComponentProps<typeof Input> & {
  label: string
  hint?: string
  error?: string
}) {
  const generated = useId()
  const id = props.id ?? generated
  return (
    <div className={`form-field ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={!!error}
        aria-describedby={error || hint ? `${id}-help` : undefined}
        {...props}
      />
      {(error || hint) && (
        <span
          id={`${id}-help`}
          className={error ? 'field-error' : 'field-hint'}
        >
          {error || hint}
        </span>
      )}
    </div>
  )
}
export function PasswordField({
  label,
  value,
  onChange,
  generate = false,
  autoComplete = 'new-password',
  placeholder,
  required,
  minLength,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  generate?: boolean
  autoComplete?: string
  placeholder?: string
  required?: boolean
  minLength?: number
}) {
  const id = useId()
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!shown) return
    const timeout = setTimeout(() => setShown(false), 30000)
    return () => clearTimeout(timeout)
  }, [shown])
  return (
    <div className='form-field'>
      <Label htmlFor={id}>{label}</Label>
      <div className='password-field'>
        <Input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          maxLength={4096}
          spellCheck={false}
          autoCapitalize='none'
        />
        <Button
          type='button'
          variant='ghost'
          size='icon'
          aria-label={shown ? `隐藏${label}` : `显示${label}`}
          onClick={() => setShown(!shown)}
        >
          {shown ? <EyeOff size={18} /> : <Eye size={18} />}
        </Button>
        {generate && (
          <Button
            type='button'
            variant='ghost'
            size='icon'
            aria-label='生成随机密码'
            onClick={() => onChange(generatePassword())}
          >
            <RefreshCw size={17} />
          </Button>
        )}
      </div>
    </div>
  )
}
