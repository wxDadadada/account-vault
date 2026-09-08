export type ModelContext = {
  registerTool: (
    tool: {
      name: string
      title: string
      description: string
      inputSchema: object
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }
      execute: (input: unknown) => unknown
    },
    options: { signal: AbortSignal }
  ) => void | Promise<void>
}
export function registerCaptureTool(
  context: ModelContext | undefined,
  stage: (text: string) => void
) {
  if (!context?.registerTool) return () => undefined
  const controller = new AbortController()
  const result = context.registerTool(
    {
      name: 'start_account_capture',
      title: '打开账号录入草稿',
      description:
        '将平台、账号与用途文字放入拾钥录入面板，等待用户整理和保存。不要包含密码、密钥或验证码。此操作不会保存账号，也不会调用云端模型。',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', minLength: 2, maxLength: 6000 } },
        required: ['text'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (
          !input ||
          typeof input !== 'object' ||
          !('text' in input) ||
          typeof input.text !== 'string' ||
          input.text.length < 2 ||
          input.text.length > 6000 ||
          Object.keys(input).some((k) => k !== 'text')
        )
          throw new Error('text 必须为 2–6000 字符的文字')
        stage(input.text)
        return { status: 'draft_opened', saved: false }
      },
    },
    { signal: controller.signal }
  )
  void Promise.resolve(result).catch(() => controller.abort())
  return () => controller.abort()
}
