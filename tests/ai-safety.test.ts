import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPublicIP, validateAIURL, containsLabeledSecret } from '../server/ai'
import { captureResponseSchema } from '../shared/protocol'
import { registerCaptureTool, type ModelContext } from '../src/vault/lib/webmcp'

test('AI proxy only accepts configured HTTPS hosts and rejects local address ranges', () => {
  assert.equal(
    validateAIURL('https://api.deepseek.com', ['api.deepseek.com']).href,
    'https://api.deepseek.com/v1/chat/completions'
  )
  assert.equal(
    validateAIURL('https://api.deepseek.com/v1', ['api.deepseek.com']).pathname,
    '/v1/chat/completions'
  )
  for (const url of [
    'http://api.deepseek.com',
    'https://attacker.invalid',
    'https://key@api.deepseek.com',
    'https://api.deepseek.com:8080',
    'https://api.deepseek.com/?secret=key',
  ])
    assert.throws(() => validateAIURL(url, ['api.deepseek.com']))
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '192.168.1.1',
    '172.16.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '0.0.0.0',
  ])
    assert.equal(isPublicIP(address), false, address)
  assert.equal(isPublicIP('8.8.8.8'), true)
})
test('labeled secrets are blocked before cloud parsing', () => {
  for (const text of [
    '密码是 Abc!123',
    '密码：long-secret',
    'password=secret',
    'API Key: sk-sample',
    '密钥改成 xyz',
  ])
    assert.equal(containsLabeledSecret(text), true)
  assert.equal(containsLabeledSecret('查找最近修改过密码的账号'), false)
})
test('model output cannot smuggle password fields or unexpected executable operations', () => {
  assert.equal(
    captureResponseSchema.safeParse({
      items: [{ platform: '测试', username: 'test' }],
    }).success,
    true
  )
  assert.equal(
    captureResponseSchema.safeParse({
      items: [{ platform: '测试', password: 'secret' }],
    }).success,
    false
  )
  assert.equal(
    captureResponseSchema.safeParse({
      items: [{ platform: '测试', action: 'delete' }],
    }).success,
    false
  )
  assert.equal(
    captureResponseSchema.safeParse({
      items: [{ platform: '测试', execute: 'drop table' }],
    }).success,
    false
  )
})
test('the optional agent tool stages text without saving or exposing account data', async () => {
  let captured: Parameters<ModelContext['registerTool']>[0] | undefined
  let signal: AbortSignal | undefined
  let staged = ''
  const dispose = registerCaptureTool(
    {
      registerTool: (tool, options) => {
        captured = tool
        signal = options.signal
      },
    },
    (text) => {
      staged = text
    }
  )
  assert.equal(captured?.name, 'start_account_capture')
  assert.deepEqual(
    await captured!.execute({ text: '记录测试平台的账号 test' }),
    { status: 'draft_opened', saved: false }
  )
  assert.equal(staged, '记录测试平台的账号 test')
  assert.throws(() => captured!.execute({ text: 'x', force: true }))
  assert.equal(staged, '记录测试平台的账号 test')
  dispose()
  assert.equal(signal?.aborted, true)
})
