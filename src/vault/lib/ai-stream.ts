import { chatResponseSchema, type ChatRequest } from '../../../shared/ai-chat'
import {
  chatStreamEventSchema,
  SSEDecoder,
  type ChatProgress,
} from '../../../shared/ai-stream'
import { APIError } from './api'
import { SESSION_EXPIRED_EVENT, sessionEpoch } from './lock-sync'

export async function streamChat(
  input: ChatRequest,
  signal: AbortSignal,
  onProgress: (event: ChatProgress) => void
) {
  const epoch = sessionEpoch()
  const check = () => {
    signal.throwIfAborted()
    if (sessionEpoch() !== epoch)
      throw new APIError('账号库状态已变化，请重新操作', 'SESSION_CHANGED', 409)
  }
  const fail = (message: string, code: string, status: number): never => {
    if (code === 'UNAUTHENTICATED' && sessionEpoch() === epoch)
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    throw new APIError(message, code, status)
  }
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Keyfolio': '1',
    },
    body: JSON.stringify(input),
  })
  check()
  if (
    !response.ok ||
    !response.headers.get('content-type')?.includes('text/event-stream')
  ) {
    const value = await response
      .json()
      .catch(() =>
        fail(
          '账号库服务返回了无效回复，请稍后重试',
          'CONNECTION',
          response.status
        )
      )
    check()
    if (!response.ok)
      fail(
        value.error || '回复失败，请稍后重试',
        value.code || 'AI_FAILED',
        response.status
      )
    return chatResponseSchema.parse(value)
  }
  if (!response.body) throw new Error('回复连接中断，请重试')
  const reader = response.body.getReader()
  const decoder = new SSEDecoder()
  let bytes = 0
  let thinking = 0
  const consume = (data: string) => {
    check()
    const event = chatStreamEventSchema.parse(JSON.parse(data))
    if (event.type === 'error')
      return fail(event.message, event.code, event.status)
    if (event.type === 'result') return event.result
    if (event.type === 'thinking') {
      thinking += event.delta.length
      if (thinking > 128000) throw new Error('模型思考内容过长，请重试')
    }
    onProgress(event)
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      check()
      if (done) {
        for (const data of decoder.finish()) {
          const result = consume(data)
          if (result) return result
        }
        throw new Error('模型连接中断，当前草稿已保留，请重试')
      }
      bytes += value.byteLength
      if (bytes > 2097152) throw new Error('模型回复过长，请缩短消息后重试')
      for (const data of decoder.push(value)) {
        const result = consume(data)
        if (result) return result
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
