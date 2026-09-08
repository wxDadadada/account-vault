import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  type LoginProfile,
  type PublicProfile,
  type VaultResponse,
} from '../../../shared/protocol'
import { api, APIError } from '../lib/api'
import {
  createCredentials,
  decryptVault,
  deriveMaster,
  encryptVault,
  makeBackup,
  recoverCredentials,
  rewrapWithMaster,
  unlockMaster,
} from '../lib/crypto'
import { demoVault } from '../lib/demo'
import { pruneHistory } from '../lib/domain'
import { downloadText } from '../lib/download'
import { advanceSessionEpoch, createLockSync } from '../lib/lock-sync'
import { emptyVault, type VaultData } from '../lib/model'
import { assertSubjectIdentities } from '../lib/subject-identity'
import { validateVault } from '../lib/validation'
import { Context, type VaultContextType } from './context'

type AuthResponse = { profile: PublicProfile; vault: VaultResponse }
type AuthStatus = {
  initialized: boolean
  profile?: LoginProfile
  requiresSetupToken?: boolean
}
function loginProfile(profile: LoginProfile): LoginProfile {
  return {
    username: profile.username,
    kdfSalt: profile.kdfSalt,
    kdfIterations: profile.kdfIterations,
    recoveryWrappedKey: profile.recoveryWrappedKey,
  }
}
export function VaultProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<VaultContextType['phase']>('loading')
  const [data, setData] = useState<VaultData | null>(null)
  const [profile, setProfile] = useState<LoginProfile | null>(null)
  const [demo, setDemo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [startupError, setStartupError] = useState('')
  const [requiresSetupToken, setRequiresSetupToken] = useState(false)
  const keyRef = useRef<CryptoKey | null>(null)
  const fullProfileRef = useRef<PublicProfile | null>(null)
  const lockSync = useRef<ReturnType<typeof createLockSync> | null>(null)
  const dataRef = useRef<VaultData | null>(null)
  const revisionRef = useRef(0)
  const epoch = useRef(0)
  const writing = useRef(false)
  const replaceData = (value: VaultData | null) => {
    dataRef.current = value
    setData(value)
  }
  const retry = useCallback(() => {
    const generation = epoch.current
    return api<AuthStatus>('/auth/status')
      .then((status) => {
        if (epoch.current !== generation) return
        setProfile(status.profile ?? null)
        setPhase(status.initialized ? 'locked' : 'setup')
        setStartupError('')
        setRequiresSetupToken(status.requiresSetupToken ?? false)
      })
      .catch((e) => {
        if (epoch.current === generation) {
          setPhase('error')
          setStartupError(e instanceof Error ? e.message : '连接失败')
        }
      })
  }, [])
  useEffect(() => {
    void retry()
  }, [retry])
  function isCurrent(generation: number) {
    lockSync.current?.check()
    return epoch.current === generation
  }
  const open = async (
    response: AuthResponse,
    key: CryptoKey,
    generation: number
  ) => {
    const unlocked = await decryptVault(key, response.vault.payload)
    if (!isCurrent(generation)) return
    advanceSessionEpoch()
    keyRef.current = key
    fullProfileRef.current = response.profile
    revisionRef.current = response.vault.revision
    setProfile(loginProfile(response.profile))
    replaceData(unlocked)
    setDemo(false)
    setPhase('open')
    setConflict(false)
    lockSync.current?.touch(true)
  }
  const clearLocal = useCallback(() => {
    advanceSessionEpoch()
    const generation = ++epoch.current
    keyRef.current = null
    fullProfileRef.current = null
    dataRef.current = null
    setData(null)
    setPhase('loading')
    setRecoveryKey(null)
    setConflict(false)
    setDemo(false)
    setBusy(false)
    return generation
  }, [])
  useEffect(() => {
    const coordinator = createLockSync(() => {
      clearLocal()
      void retry()
    })
    lockSync.current = coordinator
    return () => {
      coordinator.dispose()
      lockSync.current = null
    }
  }, [clearLocal, retry])
  const lock = useCallback(() => {
    lockSync.current?.publish()
    const generation = clearLocal()
    void api('/auth/logout', {})
      .catch(() => undefined)
      .finally(() => {
        if (epoch.current === generation) void retry()
      })
  }, [clearLocal, retry])
  useEffect(() => {
    if (phase !== 'open' || demo) return
    const touch = () => {
      if (!lockSync.current?.check()) lockSync.current?.touch()
    }
    const check = () => {
      if (lockSync.current?.check() || !dataRef.current) return
      if (
        Date.now() - (lockSync.current?.lastActivity() ?? 0) >=
        dataRef.current.preferences.autoLockMinutes * 60000 + 1000
      )
        lock()
    }
    const visibility = () => {
      if (document.visibilityState === 'visible') check()
    }
    for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
      window.addEventListener(event, touch, { passive: true })
    document.addEventListener('visibilitychange', visibility)
    const timer = setInterval(check, 10000)
    return () => {
      clearInterval(timer)
      for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
        window.removeEventListener(event, touch)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [phase, demo, lock])
  async function initialize(
    username: string,
    password: string,
    imported?: VaultData,
    setupToken?: string
  ) {
    const generation = ++epoch.current
    setBusy(true)
    try {
      if (imported) assertSubjectIdentities(imported.subjects)
      const created = await createCredentials(username, password)
      const payload = await encryptVault(created.key, imported ?? emptyVault())
      if (!isCurrent(generation)) return
      const response = await api<AuthResponse>('/auth/setup', {
        credentials: created.credentials,
        payload,
        ...(setupToken ? { setupToken } : {}),
      })
      if (!isCurrent(generation)) return
      await open(response, created.key, generation)
      if (isCurrent(generation)) setRecoveryKey(created.recoveryKey)
    } finally {
      if (epoch.current === generation) setBusy(false)
    }
  }
  async function unlock(username: string, password: string, otp?: string) {
    if (!profile) throw new Error('请刷新页面后重试')
    setBusy(true)
    const generation = ++epoch.current
    try {
      const status = await api<AuthStatus>('/auth/status')
      if (!isCurrent(generation)) return
      if (!status.profile) throw new Error('账号空间尚未初始化')
      setProfile(status.profile)
      const { authProof } = await deriveMaster(password, status.profile.kdfSalt)
      if (!isCurrent(generation)) return
      const response = await api<AuthResponse>('/auth/login', {
        username,
        authProof,
        ...(otp ? { otp } : {}),
      })
      const { key } = await unlockMaster(password, response.profile)
      if (!isCurrent(generation)) return
      await open(response, key, generation)
    } finally {
      if (epoch.current === generation) setBusy(false)
    }
  }
  async function recover(recovery: string, password: string) {
    if (!profile) throw new Error('账号空间尚未初始化')
    setBusy(true)
    const generation = ++epoch.current
    try {
      const status = await api<AuthStatus>('/auth/status')
      if (!isCurrent(generation)) return
      if (!status.profile) throw new Error('账号空间尚未初始化')
      setProfile(status.profile)
      let result: Awaited<ReturnType<typeof recoverCredentials>>
      try {
        result = await recoverCredentials(recovery, password, status.profile)
      } catch {
        throw new Error('恢复密钥不正确，或不是这个账号空间的恢复密钥')
      }
      if (!isCurrent(generation)) return
      const response = await api<AuthResponse>('/auth/recover', {
        currentRecoveryProof: result.currentRecoveryProof,
        credentials: result.credentials,
      })
      if (!isCurrent(generation)) return
      lockSync.current?.publish()
      await open(response, result.key, generation)
      if (isCurrent(generation)) setRecoveryKey(result.recoveryKey)
    } finally {
      if (epoch.current === generation) setBusy(false)
    }
  }
  async function changeMaster(current: string, next: string) {
    if (!fullProfileRef.current || demo)
      throw new Error('请在正式账号空间中操作')
    setBusy(true)
    const generation = ++epoch.current
    try {
      let result: Awaited<ReturnType<typeof rewrapWithMaster>>
      try {
        result = await rewrapWithMaster(current, next, fullProfileRef.current)
      } catch {
        throw new Error('当前主密码不正确')
      }
      if (!isCurrent(generation)) return
      const response = await api<AuthResponse>('/auth/credentials', {
        currentProof: result.currentProof,
        credentials: result.credentials,
      })
      if (!isCurrent(generation)) return
      lockSync.current?.publish()
      await open(response, result.key, generation)
      if (isCurrent(generation)) setRecoveryKey(result.recoveryKey)
    } finally {
      if (epoch.current === generation) setBusy(false)
    }
  }
  async function commit(transform: (draft: VaultData) => VaultData) {
    if (!dataRef.current) throw new Error('请先解锁账号库')
    if (writing.current) throw new Error('上一条修改正在保存，请稍后再试')
    const generation = epoch.current
    writing.current = true
    setBusy(true)
    try {
      const next = validateVault(
        pruneHistory(transform(structuredClone(dataRef.current)))
      )
      if (!demo) {
        if (!keyRef.current) throw new Error('账号库已锁定')
        const payload = await encryptVault(keyRef.current, next)
        if (!isCurrent(generation)) return
        const response = await api<VaultResponse>(
          '/vault',
          { revision: revisionRef.current, payload },
          'PUT'
        )
        if (!isCurrent(generation)) return
        revisionRef.current = response.revision
      }
      replaceData(next)
      setConflict(false)
    } catch (e) {
      if (
        epoch.current === generation &&
        e instanceof APIError &&
        e.code === 'REVISION_CONFLICT'
      )
        setConflict(true)
      if (
        epoch.current === generation &&
        e instanceof APIError &&
        e.code === 'UNAUTHENTICATED'
      )
        lock()
      throw e
    } finally {
      writing.current = false
      if (epoch.current === generation) setBusy(false)
    }
  }
  async function sync() {
    if (demo) {
      toast('体验模式的数据仅保留在本次页面中')
      return
    }
    if (!keyRef.current || writing.current) return
    const generation = epoch.current
    writing.current = true
    setBusy(true)
    try {
      const response = await api<VaultResponse>('/vault')
      if (!isCurrent(generation)) return
      const value = await decryptVault(keyRef.current, response.payload)
      if (!isCurrent(generation)) return
      revisionRef.current = response.revision
      replaceData(value)
      setConflict(false)
      toast.success('已同步最新内容')
    } catch (e) {
      if (
        epoch.current === generation &&
        e instanceof APIError &&
        e.code === 'UNAUTHENTICATED'
      )
        lock()
      throw e
    } finally {
      writing.current = false
      if (epoch.current === generation) setBusy(false)
    }
  }
  async function exportBackup() {
    if (!keyRef.current || !fullProfileRef.current || !dataRef.current || demo)
      throw new Error('请先创建并解锁正式账号空间')
    const generation = epoch.current
    const backup = await makeBackup(
      dataRef.current,
      keyRef.current,
      fullProfileRef.current
    )
    if (!isCurrent(generation)) return
    downloadText(
      JSON.stringify(backup, null, 2),
      `keyfolio-${new Date().toISOString().slice(0, 10)}.keyfolio.json`
    )
  }
  function startDemo() {
    epoch.current++
    keyRef.current = null
    fullProfileRef.current = null
    setDemo(true)
    replaceData(demoVault())
    setPhase('open')
    setRecoveryKey(null)
  }
  return (
    <Context.Provider
      value={{
        phase,
        data,
        profile,
        demo,
        busy,
        conflict,
        recoveryKey,
        startupError,
        requiresSetupToken,
        initialize,
        unlock,
        recover,
        changeMaster,
        lock,
        startDemo,
        retry,
        dismissRecovery: () => setRecoveryKey(null),
        sync,
        commit,
        exportBackup,
      }}
    >
      {children}
    </Context.Provider>
  )
}
