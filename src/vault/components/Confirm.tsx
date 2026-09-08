import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Busy } from './ui'

export type Confirmation = {
  title: string
  description: string
  label: string
  cancelLabel?: string
  danger?: boolean
  action: () => void | Promise<void>
}
export function Confirm({
  value,
  onClose,
}: {
  value: Confirmation
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function perform() {
    setBusy(true)
    setError('')
    try {
      await value.action()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent
        className='confirm-dialog'
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!busy) onClose()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{value.title}</AlertDialogTitle>
          <AlertDialogDescription>{value.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div className='form-error' role='alert'>
            {error}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {value.cancelLabel ?? '取消'}
          </AlertDialogCancel>
          <Button
            variant={value.danger ? 'destructive' : 'default'}
            disabled={busy}
            onClick={() => void perform()}
          >
            {busy ? <Busy /> : value.label}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
