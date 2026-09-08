import { createContext, useContext } from 'react'
import { type LoginProfile } from '../../../shared/protocol'
import { type VaultData } from '../lib/model'

export type VaultContextType = {
  phase: 'loading' | 'setup' | 'locked' | 'open' | 'error'
  data: VaultData | null
  profile: LoginProfile | null
  demo: boolean
  busy: boolean
  conflict: boolean
  recoveryKey: string | null
  startupError: string
  requiresSetupToken: boolean
  initialize: (
    username: string,
    password: string,
    imported?: VaultData,
    setupToken?: string
  ) => Promise<void>
  unlock: (username: string, password: string, otp?: string) => Promise<void>
  recover: (key: string, password: string) => Promise<void>
  changeMaster: (current: string, next: string) => Promise<void>
  lock: () => void
  startDemo: () => void
  retry: () => Promise<void>
  dismissRecovery: () => void
  sync: () => Promise<void>
  commit: (transform: (draft: VaultData) => VaultData) => Promise<void>
  exportBackup: () => Promise<void>
}
export const Context = createContext<VaultContextType | null>(null)
export function useVault() {
  const value = useContext(Context)
  if (!value) throw new Error('Missing vault context')
  return value
}
