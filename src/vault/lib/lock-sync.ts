export const LOCK_VERSION_KEY = 'keyfolio.lock-version'
export const LAST_ACTIVITY_KEY = 'keyfolio.last-activity'
export const SESSION_EXPIRED_EVENT = 'keyfolio:session-expired'
let requestEpoch = 0
export const sessionEpoch = () => requestEpoch
export const advanceSessionEpoch = () => {
  requestEpoch++
}

function stored(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return undefined
  }
}
function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    // BroadcastChannel still reaches live pages. Resume fails closed below.
    return false
  }
}
function writableStorage() {
  const probe = 'keyfolio.lock-storage-probe'
  try {
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

export function createLockSync(onLock: () => void) {
  let version = stored(LOCK_VERSION_KEY)
  let messageVersion = version
  let activity = 0
  let publishedAt = 0
  let channel: BroadcastChannel | undefined
  try {
    channel = new BroadcastChannel('keyfolio-lock')
  } catch {
    // Storage events and the resume check also work without BroadcastChannel.
  }
  const check = () => {
    const current = stored(LOCK_VERSION_KEY)
    if (current !== undefined && current !== version) {
      version = current
      messageVersion = current
      onLock()
      return true
    }
    return false
  }
  const publish = () => {
    advanceSessionEpoch()
    messageVersion = crypto.randomUUID()
    const persisted = persist(LOCK_VERSION_KEY, messageVersion)
    if (persisted) version = messageVersion
    channel?.postMessage({ type: 'lock', version: messageVersion, persisted })
  }
  const touch = (force = false) => {
    activity = Date.now()
    if (force || activity - publishedAt >= 1000) {
      publishedAt = activity
      persist(LAST_ACTIVITY_KEY, String(activity))
      channel?.postMessage({ type: 'activity', at: activity })
    }
  }
  const lastActivity = () => {
    const saved = Number(stored(LAST_ACTIVITY_KEY))
    return Math.max(
      activity,
      Number.isFinite(saved) && saved <= Date.now() ? saved : 0
    )
  }
  const receive = ({ data }: MessageEvent<unknown>) => {
    if (!data || typeof data !== 'object' || !('type' in data)) return
    if (
      data.type === 'lock' &&
      'version' in data &&
      typeof data.version === 'string'
    ) {
      if (
        !('persisted' in data && data.persisted === false) &&
        stored(LOCK_VERSION_KEY) !== undefined
      )
        check()
      else if (data.version !== messageVersion) {
        messageVersion = data.version
        onLock()
      }
    } else if (
      data.type === 'activity' &&
      'at' in data &&
      typeof data.at === 'number' &&
      Number.isFinite(data.at) &&
      data.at <= Date.now()
    ) {
      activity = Math.max(activity, data.at)
    }
  }
  const storage = (event: StorageEvent) => {
    if (event.key === LOCK_VERSION_KEY || event.key === null) check()
  }
  const resume = () => {
    if (document.visibilityState !== 'visible') return
    if (!writableStorage()) onLock()
    else check()
  }
  const pageShow = (event: PageTransitionEvent) => {
    if (event.persisted) onLock()
    else resume()
  }
  const pageHide = () => onLock()
  const blur = () => {
    if (!writableStorage()) onLock()
  }
  const guard = (event: Event) => {
    if (check()) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }
  const expired = () => {
    if (check()) return
    publish()
    onLock()
  }
  channel?.addEventListener('message', receive)
  window.addEventListener('storage', storage)
  window.addEventListener('focus', resume)
  window.addEventListener('blur', blur)
  window.addEventListener('pageshow', pageShow)
  window.addEventListener('pagehide', pageHide)
  window.addEventListener(SESSION_EXPIRED_EVENT, expired)
  document.addEventListener('visibilitychange', resume)
  for (const event of ['pointerdown', 'keydown', 'click'])
    window.addEventListener(event, guard, true)
  return {
    check,
    publish,
    touch,
    lastActivity,
    dispose() {
      channel?.close()
      window.removeEventListener('storage', storage)
      window.removeEventListener('focus', resume)
      window.removeEventListener('blur', blur)
      window.removeEventListener('pageshow', pageShow)
      window.removeEventListener('pagehide', pageHide)
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired)
      document.removeEventListener('visibilitychange', resume)
      for (const event of ['pointerdown', 'keydown', 'click'])
        window.removeEventListener(event, guard, true)
    },
  }
}
