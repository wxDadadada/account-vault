import { SESSION_EXPIRED_EVENT, sessionEpoch } from './lock-sync'

export class APIError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number
  ) {
    super(message)
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  signal?: AbortSignal
): Promise<T> {
  const epoch = sessionEpoch()
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'X-Keyfolio': '1',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw new APIError(
      '无法连接账号库服务，请检查服务是否正在运行',
      'CONNECTION',
      response.status
    )
  }
  if (!response.ok) {
    const error = result as { error?: string; code?: string }
    if (
      error.code === 'UNAUTHENTICATED' &&
      typeof window !== 'undefined' &&
      sessionEpoch() === epoch
    )
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    throw new APIError(
      error.error || '请求失败，请稍后重试',
      error.code || 'REQUEST_FAILED',
      response.status
    )
  }
  if (sessionEpoch() !== epoch)
    throw new APIError('账号库状态已变化，请重新操作', 'SESSION_CHANGED', 409)
  return result as T
}
