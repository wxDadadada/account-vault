import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callChat } from '../server/ai'
import { validateChatOutput } from '../server/ai-output'
import {
  ModelStreamDecoder,
  modelRequestBody,
  parseModelOutput,
} from '../server/ai-provider'
import { type ChatRequest } from '../shared/ai-chat'
import {
  SSEDecoder,
  partialReply,
  type ChatProgress,
} from '../shared/ai-stream'

const encode = (text: string) => new TextEncoder().encode(text)
const frame = (data: unknown) => `data: ${JSON.stringify(data)}\r\n\r\n`
const input: ChatRequest = {
  mode: 'capture',
  turns: [{ text: '补充账号', field: 'username', itemIndex: 0 }],
  context: {
    items: [
      {
        platform: 'GitHub',
        draftId: 'one',
        action: 'create',
        subject: '我个人',
        notes: '保留备注',
      },
    ],
    plan: null,
  },
  categories: [],
  config: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    apiKey: 'synthetic',
  },
}
test('SSE decodes byte-split Chinese, CRLF, comments and multiline data; limits oversized frames', () => {
  const decoder = new SSEDecoder()
  const events: string[] = []
  for (const byte of encode(
    ': heartbeat\r\n\r\ndata: 中文\r\ndata: 第二行\r\n\r\n'
  ))
    events.push(...decoder.push(Uint8Array.of(byte)))
  assert.deepEqual(events, ['中文\n第二行'])
  assert.deepEqual(decoder.finish(), [])
  assert.throws(
    () => new SSEDecoder(10).push(encode('data: ' + 'x'.repeat(20) + '\n\n')),
    /过大/
  )
  assert.equal(partialReply('{"reply":"你\\n\\u597d\\uD83D'), '你\n好')
  assert.equal(
    partialReply('{"reply":"你\\n\\u597d\\uD83D\\uDE00"}'),
    '你\n好😀'
  )
})
test('provider exposes real thought/reply deltas and rejects incomplete, malformed and truncated responses', () => {
  const events: ChatProgress[] = []
  const decoder = new ModelStreamDecoder((event) => events.push(event))
  const content = JSON.stringify({
    mode: 'capture',
    reply: '已整理。',
    items: [{ platform: 'GitHub' }],
  })
  const wire =
    frame({ choices: [{ delta: { reasoning_content: '先识别平台' } }] }) +
    [...content]
      .map((content) => frame({ choices: [{ delta: { content } }] }))
      .join('') +
    frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
    'data: [DONE]\n\n'
  for (const byte of encode(wire)) decoder.push(Uint8Array.of(byte))
  assert.deepEqual(decoder.finish(), JSON.parse(content))
  assert.equal(events[0].type, 'thinking')
  assert.ok(events.filter((event) => event.type === 'reply').length >= 3)
  const broken = new ModelStreamDecoder()
  broken.push(encode(frame({ choices: [{ delta: { content } }] })))
  assert.throws(() => broken.finish(), /中断/)
  for (const data of ['null', 'not-json'])
    assert.throws(
      () => new ModelStreamDecoder().push(encode(`data: ${data}\n\n`)),
      /无法识别/
    )
  assert.throws(() => parseModelOutput(content, 'length'), /截断/)
  assert.throws(() => parseModelOutput(''), /空回复/)
  assert.throws(
    () => new ModelStreamDecoder().push(new Uint8Array(8388609)),
    /过大/
  )
  const request = modelRequestBody(input.config, [], { onProgress: () => {} })
  assert.equal(request.stream, true)
  assert.equal(request.max_tokens, 8192)
  assert.deepEqual(request.thinking, { type: 'enabled' })
  assert.equal(request.reasoning_effort, 'low')
})

test('chat repairs invalid model structure once, preserves context, and does not retry network failures or cancellation', async () => {
  const phases: string[] = []
  let calls = 0
  const response = await callChat(
    input,
    undefined,
    {
      onProgress: (event) => {
        if (event.type === 'status') phases.push(event.phase)
      },
    },
    async (_config, messages, _hosts, options) => {
      calls++
      if (calls === 1)
        return { items: [{ platform: 'GitHub', password: 'invalid-output' }] }
      assert.equal(options?.retry, true)
      assert.equal(options?.thinking, false)
      assert.ok(messages.at(-1)?.content.includes('未通过校验'))
      return {
        items: [{ platform: 'GitHub', username: 'new-user', draftId: 'one' }],
      }
    }
  )
  assert.equal(response.mode, 'capture')
  assert.equal(calls, 2)
  assert.ok(phases.includes('repairing'))
  calls = 0
  await assert.rejects(
    callChat(input, undefined, {}, async () => {
      calls++
      throw new Error('network-failed')
    }),
    /network-failed/
  )
  assert.equal(calls, 1)
  const controller = new AbortController()
  await assert.rejects(
    callChat(input, undefined, { signal: controller.signal }, async () => {
      controller.abort()
      throw controller.signal.reason
    }),
    /abort/i
  )
  calls = 0
  await assert.rejects(
    callChat(input, undefined, {}, async () => {
      calls++
      return { invalid: true }
    }),
    /仍不完整/
  )
  assert.equal(calls, 2)
})
test('normalization repairs optional nulls and IDs while preserving existing fields and rejecting destructive output', () => {
  const result = validateChatOutput(
    {
      items: [
        {
          platform: 'GitHub',
          username: 'new-user',
          subject: null,
          notes: null,
        },
      ],
    },
    input
  )
  assert.equal(result.mode, 'capture')
  if (result.mode !== 'capture') return
  assert.deepEqual(result.items[0], {
    ...input.context.items[0],
    username: 'new-user',
  })
  for (const bad of [
    { items: [{ platform: 'GitHub', password: 'secret' }] },
    { items: [{ platform: 'GitHub', action: 'delete' }] },
    { mode: 'search', reply: '', plan: { keywords: [] } },
    {
      items: [
        { platform: 'GitHub', draftId: 'one' },
        { platform: 'GitHub', draftId: 'one' },
      ],
    },
    { items: [] },
  ])
    assert.throws(() => validateChatOutput(bad, input))
  const ambiguous: ChatRequest = {
    ...input,
    turns: [{ text: '修改第二条', field: 'details' as const }],
    context: {
      ...input.context,
      items: [
        ...input.context.items,
        { platform: 'GitHub', draftId: 'two', action: 'create' },
      ],
    },
  }
  assert.throws(
    () =>
      validateChatOutput(
        { items: [{ platform: 'GitHub', username: 'different' }] },
        ambiguous
      ),
    /draftId/
  )
  assert.deepEqual(
    validateChatOutput(
      { items: [] },
      { ...input, context: { items: [], plan: null } }
    ),
    { mode: 'capture', reply: '', items: [{ action: 'create', platform: '' }] }
  )
})
