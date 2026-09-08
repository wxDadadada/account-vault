import { useState } from 'react'
import { Confirm, type Confirmation } from '../components/Confirm'

type DiscardRequest = {
  when: boolean
  action: () => void
  title?: string
  description?: string
  label?: string
}

export function useDiscardConfirmation() {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  function confirmDiscard({ when, action, ...copy }: DiscardRequest) {
    if (!when) {
      action()
      return
    }
    setConfirmation({
      title: '放弃未保存的修改？',
      description: '刚才填写的内容还没有保存。返回继续编辑，或放弃这些修改。',
      label: '放弃修改',
      cancelLabel: '继续编辑',
      danger: true,
      ...copy,
      action,
    })
  }
  function onEscapeKeyDown(event: KeyboardEvent) {
    // The parent can still own Escape during the first frame of a nested dialog.
    if (confirmation) {
      event.preventDefault()
      event.stopPropagation()
      setConfirmation(null)
    }
  }
  return {
    confirmDiscard,
    onEscapeKeyDown,
    discardDialog: confirmation ? (
      <Confirm value={confirmation} onClose={() => setConfirmation(null)} />
    ) : null,
  }
}
