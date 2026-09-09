import ipaddr from 'ipaddr.js'
import { lookup } from 'node:dns/promises'
import { Agent, fetch } from 'undici'
import { type ChatRequest } from '../shared/ai-chat.js'
import {
  partialReply,
  SSEDecoder,
  type ChatProgress,
} from '../shared/ai-stream.js'

export const defaultAIHosts = [
  'api.deepseek.com',
  'api.openai.com',
  'api.moonshot.cn',
  'api.moonshot.ai',
  'dashscope.aliyuncs.com',
  'openrouter.ai',
]
export function validateAIURL(baseUrl: string, allowedHosts: string[]) {
  const url = new URL(baseUrl)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443') ||
    !allowedHosts.includes(url.hostname.toLowerCase())
  )
    throw new Error(
      'AI 地址不在允许列表中，请检查服务地址或 AI_ALLOWED_HOSTS 配置'
    )
  const path = url.pathname.replace(/\/$/, '')
  url.pathname = path.endsWith('/chat/completions')
    ? path
    : `${path || '/v1'}/chat/completions`
  return url
}
export function isPublicIP(address: string) {
  if (!ipaddr.isValid(address)) return false
  let parsed = ipaddr.parse(address)
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress())
    parsed = (parsed as ipaddr.IPv6).toIPv4Address()
  return parsed.range() === 'unicast'
}

export class ModelOutputError extends Error {
  constructor(
    message: string,
    public output = ''
  ) {
    super(message)
  }
}
export type ModelProgressOptions = {
  signal?: AbortSignal
  onProgress?: (event: ChatProgress) => void
  retry?: boolean
  thinking?: boolean
}
export type ModelMessage = { role: string; content: string }

export function modelRequestBody(
  config: ChatRequest['config'],
  messages: ModelMessage[],
  options: ModelProgressOptions = {}
) {
  const deepseek = new URL(config.baseUrl).hostname === 'api.deepseek.com'
  return {
    model: config.model,
    temperature: 0,
    max_tokens: deepseek ? (options.retry ? 12000 : 8192) : 4000,
    response_format: { type: 'json_object' },
    stream: !!options.onProgress,
    ...(deepseek && /^deepseek-v4-/.test(config.model)
      ? {
          thinking: {
            type: options.thinking === false ? 'disabled' : 'enabled',
          },
          reasoning_effort: 'low',
        }
      : {}),
    messages,
  }
}

type ModelChunk = {
  error?: unknown
  choices?: {
    finish_reason?: string | null
    delta?: { reasoning_content?: string; content?: string }
    message?: { content?: string }
  }[]
}

/** Streamed prefixes only reach the display; callers validate the complete result. */
export class ModelStreamDecoder {
  private sse = new SSEDecoder()
  private content = ''
  private thinkingLength = 0
  private reply = ''
  private finishReason = ''
  private done = false
  private bytes = 0

  constructor(private onProgress?: (event: ChatProgress) => void) {}

  push(chunk: Uint8Array) {
    this.bytes += chunk.byteLength
    // Per-token JSON envelopes are much larger than the assembled model text.
    if (this.bytes > 8388608)
      throw new Error('模型返回内容过大，请缩短录入文字')
    for (const data of this.sse.push(chunk)) this.event(data)
  }

  finish() {
    for (const data of this.sse.finish()) this.event(data)
    if (!this.done && !this.finishReason)
      throw new Error('模型连接中断，当前草稿已保留，请重试')
    return parseModelOutput(this.content, this.finishReason)
  }

  private event(data: string) {
    if (data === '[DONE]') {
      this.done = true
      return
    }
    let event: ModelChunk
    try {
      event = JSON.parse(data) as ModelChunk
    } catch {
      throw new ModelOutputError('模型返回了无法识别的流式内容')
    }
    if (!event || typeof event !== 'object' || Array.isArray(event))
      throw new ModelOutputError('模型返回了无法识别的流式内容')
    if (this.done) return
    if (event.error) throw new Error('模型服务返回错误，请稍后重试')
    const choice = event.choices?.[0]
    if (!choice) return
    if (choice.finish_reason) this.finishReason = choice.finish_reason
    const thinking = choice.delta?.reasoning_content
    if (typeof thinking === 'string' && this.thinkingLength < 64000) {
      const delta = thinking.slice(0, 64000 - this.thinkingLength)
      if (delta) {
        this.thinkingLength += delta.length
        this.onProgress?.({ type: 'thinking', delta })
      }
    }
    const content = choice.delta?.content
    if (typeof content === 'string') {
      this.content += content
      if (this.content.length > 256000)
        throw new Error('模型返回内容过大，请缩短录入文字')
      const reply = partialReply(this.content)
      if (reply !== this.reply) {
        this.reply = reply
        this.onProgress?.({ type: 'reply', text: reply })
      }
    }
  }
}

export function parseModelOutput(
  content: unknown,
  finishReason?: string | null
): unknown {
  if (finishReason === 'length')
    throw new ModelOutputError(
      '模型回复被截断，正在重新整理',
      typeof content === 'string' ? content : ''
    )
  if (typeof content !== 'string' || !content.trim())
    throw new ModelOutputError('模型返回了空回复，请重试')
  try {
    return JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
    )
  } catch {
    throw new ModelOutputError('模型回复不是完整的 JSON', content)
  }
}

export async function requestModel(
  config: ChatRequest['config'],
  messages: ModelMessage[],
  allowedHosts: string[],
  options: ModelProgressOptions = {}
): Promise<unknown> {
  const url = validateAIURL(config.baseUrl, allowedHosts)
  const addresses = await lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some((a) => !isPublicIP(a.address)))
    throw new Error('AI 地址必须解析到公网地址')
  options.signal?.throwIfAborted()
  // Keep DNS validation pinned to the actual connection, including retries.
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, settings, callback) => {
        if (settings.all) callback(null, addresses)
        else callback(null, addresses[0].address, addresses[0].family)
      },
    },
  })
  const timeout = AbortSignal.timeout(120000)
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout
  try {
    const response = await fetch(url, {
      method: 'POST',
      dispatcher,
      redirect: 'manual',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(modelRequestBody(config, messages, options)),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'AI 服务拒绝了密钥，请检查配置'
          : response.status === 429
            ? '模型服务繁忙，请稍后重试'
            : `AI 服务暂时不可用（${response.status}）`
      )
    }
    if (!response.body) throw new ModelOutputError('模型返回了空回复，请重试')
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const decoder = new ModelStreamDecoder(options.onProgress)
      for await (const chunk of response.body) decoder.push(chunk)
      return decoder.finish()
    }
    // Some compatible providers ignore stream=true and return a single JSON reply.
    const chunks: Uint8Array[] = []
    let bytes = 0
    for await (const chunk of response.body) {
      bytes += chunk.byteLength
      if (bytes > 1024000) throw new Error('模型返回内容过大，请缩短录入文字')
      chunks.push(chunk)
    }
    let data: ModelChunk
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ModelChunk
    } catch {
      throw new ModelOutputError('模型服务返回了无法识别的内容')
    }
    return parseModelOutput(
      data?.choices?.[0]?.message?.content,
      data?.choices?.[0]?.finish_reason
    )
  } catch (error) {
    if (
      options.signal?.aborted &&
      options.signal.reason?.name !== 'TimeoutError'
    )
      throw error
    if (
      timeout.aborted ||
      (error instanceof Error && error.name === 'TimeoutError')
    )
      throw new Error('模型回复超时，当前草稿已保留，请重试或切换本地助手', {
        cause: error,
      })
    if (error instanceof TypeError && /fetch/i.test(error.message))
      throw new Error('暂时无法连接模型服务，当前草稿已保留，请稍后重试', {
        cause: error,
      })
    throw error
  } finally {
    await dispatcher.destroy().catch(() => undefined)
  }
}
