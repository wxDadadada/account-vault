import { z } from 'zod'
import { chatResponseSchema } from './ai-chat.js'

export const chatProgressSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('status'),
      phase: z.enum([
        'connecting',
        'thinking',
        'replying',
        'validating',
        'repairing',
      ]),
    })
    .strict(),
  z
    .object({ type: z.literal('thinking'), delta: z.string().max(64000) })
    .strict(),
  z.object({ type: z.literal('reply'), text: z.string().max(1200) }).strict(),
])
export const chatStreamEventSchema = z.union([
  chatProgressSchema,
  z.object({ type: z.literal('result'), result: chatResponseSchema }).strict(),
  z
    .object({
      type: z.literal('error'),
      message: z.string().max(1200),
      code: z.string().max(100),
      status: z.number().int().min(400).max(599),
    })
    .strict(),
])
export type ChatProgress = z.infer<typeof chatProgressSchema>
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>

/** Decode SSE data frames across arbitrary UTF-8 and newline boundaries. */
export class SSEDecoder {
  private decoder = new TextDecoder()
  private pending = ''

  constructor(private limit = 256000) {}

  push(chunk: Uint8Array): string[] {
    this.pending += this.decoder.decode(chunk, { stream: true })
    return this.take(false)
  }

  finish(): string[] {
    this.pending += this.decoder.decode()
    return this.take(true)
  }

  private take(final: boolean): string[] {
    const values: string[] = []
    let boundary: RegExpExecArray | null
    while ((boundary = /\r?\n\r?\n/.exec(this.pending))) {
      this.frame(this.pending.slice(0, boundary.index), values)
      this.pending = this.pending.slice(boundary.index + boundary[0].length)
    }
    if (this.pending.length > this.limit)
      throw new Error('模型返回内容过大，请缩短录入文字')
    if (final && this.pending) {
      this.frame(this.pending, values)
      this.pending = ''
    }
    return values
  }

  private frame(value: string, output: string[]) {
    if (value.length > this.limit)
      throw new Error('模型返回内容过大，请缩短录入文字')
    const data = value
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
    if (data.length) output.push(data.join('\n'))
  }
}

/** A display-only prefix. It is never used to populate or save account fields. */
export function partialReply(json: string): string {
  const match = /"reply"\s*:\s*"/.exec(json)
  if (!match) return ''
  let result = ''
  for (
    let index = match.index + match[0].length;
    index < json.length;
    index++
  ) {
    const char = json[index]
    if (char === '"') break
    if (char !== '\\') {
      result += char
      continue
    }
    const escaped = json[++index]
    if (escaped === undefined) break
    if (escaped === 'u') {
      const digits = json.slice(index + 1, index + 5)
      if (!/^[0-9a-f]{4}$/i.test(digits)) break
      result += String.fromCharCode(parseInt(digits, 16))
      index += 4
    } else {
      const replacements: Record<string, string> = {
        '"': '"',
        '\\': '\\',
        '/': '/',
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
      }
      if (!(escaped in replacements)) break
      result += replacements[escaped]
    }
  }
  // A streamed Unicode escape can end between the halves of a surrogate pair.
  return result.replace(/[\uD800-\uDBFF]$/, '').slice(0, 1200)
}
