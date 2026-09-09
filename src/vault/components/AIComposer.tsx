import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  LockKeyhole,
  MessageCircle,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Square,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  assertChatSafe,
  chatRequestSchema,
  chatResponseSchema,
  MAX_CHAT_CHARACTERS,
  MAX_CHAT_TURNS,
  type ChatTurn,
} from '../../../shared/ai-chat'
import type { ChatProgress } from '../../../shared/ai-stream'
import { type SearchPlan } from '../../../shared/protocol'
import { useDiscardConfirmation } from '../hooks/use-discard-confirmation'
import {
  captureQuestion,
  draftFor,
  inferChatMode,
  localChat,
  materializeDrafts,
  patchDraft,
  saveDrafts,
  searchFeedback,
  type Draft,
  type Question,
} from '../lib/ai-conversation'
import { streamChat } from '../lib/ai-stream'
import { sessionEpoch } from '../lib/lock-sync'
import { type Account } from '../lib/model'
import { useVault } from '../state/context'
import { AIDraftReview } from './AIDraftReview'
import { FieldSelect, FieldOption } from './controls'
import { PasswordField } from './fields'
import { Busy, PlatformIcon } from './ui'

type Mode = 'capture' | 'search'
type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
  thinking?: string
}
type Progress = {
  phase: Extract<ChatProgress, { type: 'status' }>['phase']
  thinking: string
  reply: string
}
const emptyProgress = (): Progress => ({
  phase: 'connecting',
  thinking: '',
  reply: '',
})
const phaseLabels = {
  connecting: '正在连接模型…',
  thinking: '正在思考…',
  replying: '正在生成回复…',
  validating: '正在核对草稿…',
  repairing: '正在重新整理格式…',
}
type Conversation = {
  messages: Message[]
  turns: ChatTurn[]
  drafts: Draft[]
  plan: SearchPlan | null
  question: Question | null
  choices: string[]
}
const message = (
  role: Message['role'],
  text: string,
  thinking?: string
): Message => ({
  id: crypto.randomUUID(),
  role,
  text,
  thinking,
})
const fresh = (mode: Mode): Conversation => ({
  messages: [
    message(
      'assistant',
      mode === 'capture'
        ? '想记录哪个账号？先说你知道的部分，缺少的信息我会继续问。也可以告诉我要更新哪条记录。'
        : '你想找什么账号？可以说平台、主体或变更时间，查到后还能继续补充条件。'
    ),
  ],
  turns: [],
  drafts: [],
  plan: null,
  question: null,
  choices: [],
})

export function AIComposer({
  initialMode = 'capture',
  initialText = '',
  defaultSubject = 'all',
  suspended = false,
  onClose,
  onSelect,
}: {
  initialMode?: Mode
  initialText?: string
  defaultSubject?: string
  suspended?: boolean
  onClose: () => void
  onSelect: (account: Account) => void
}) {
  const { data, commit, busy, demo } = useVault()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [conversations, setConversations] = useState(() => ({
    capture: fresh('capture'),
    search: fresh('search'),
  }))
  const [inputs, setInputs] = useState({
    capture: initialMode === 'capture' ? initialText : '',
    search: initialMode === 'search' ? initialText : '',
  })
  const text = inputs[mode]
  const setInput = (kind: Mode, value: string) =>
    setInputs((all) => ({ ...all, [kind]: value }))
  const setText = (value: string) => setInput(mode, value)
  const [engine, setEngine] = useState(
    data?.ai.apiKey && !demo ? 'cloud' : 'local'
  )
  const [working, setWorking] = useState(false)
  const [pendingText, setPendingText] = useState('')
  const [progress, setProgress] = useState(emptyProgress)
  const [elapsed, setElapsed] = useState(0)
  const [draftExpanded, setDraftExpanded] = useState(false)
  const [error, setError] = useState('')
  const [review, setReview] = useState(false)
  const { confirmDiscard, discardDialog, onEscapeKeyDown } =
    useDiscardConfirmation()
  const request = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const scroll = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const input = useRef<HTMLTextAreaElement>(null)
  const current = conversations[mode]
  const capture = conversations.capture
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      request.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (!review && scroll.current && follow.current)
      scroll.current.scrollTop = scroll.current.scrollHeight
  }, [current.messages.length, pendingText, progress, mode, review])
  useEffect(() => {
    if (!working) return
    const started = Date.now()
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000
    )
    return () => clearInterval(timer)
  }, [working])
  if (!data) return null
  const currentData = data
  const feedback = current.plan
    ? searchFeedback(
        current.plan,
        currentData,
        current.turns[current.turns.length - 1]?.text ?? ''
      )
    : null
  const question =
    mode === 'capture' ? captureQuestion(current.drafts, currentData) : null
  const ready = mode === 'capture' && current.drafts.length > 0 && !question
  const update = (kind: Mode, change: (value: Conversation) => Conversation) =>
    setConversations((all) => ({ ...all, [kind]: change(all[kind]) }))
  const setDrafts = (value: Draft[] | ((value: Draft[]) => Draft[])) =>
    update('capture', (previous) => ({
      ...previous,
      drafts: typeof value === 'function' ? value(previous.drafts) : value,
    }))
  function close() {
    request.current?.abort()
    onClose()
  }
  function requestClose() {
    if (busy) return
    confirmDiscard({
      when:
        !!capture.drafts.length ||
        !!inputs.capture.trim() ||
        !!inputs.search.trim() ||
        working,
      title: '关闭助手并放弃草稿？',
      description:
        '尚未保存的账号草稿和未发送的消息会被清除，已保存的账号会保留。',
      label: '放弃并关闭',
      action: close,
    })
  }
  function stopReply() {
    const controller = request.current
    if (!controller) return
    request.current = null
    controller.abort()
    setWorking(false)
    setText(pendingText)
    setPendingText('')
    setProgress(emptyProgress())
    setError('已停止，本次输入和之前的草稿已保留')
    requestAnimationFrame(() => input.current?.focus())
  }
  function switchMode(next: Mode) {
    follow.current = true
    setMode(next)
    setReview(false)
    setError('')
    input.current?.focus()
  }
  function startNew() {
    follow.current = true
    update(mode, () => fresh(mode))
    setText('')
    setError('')
    setReview(false)
    input.current?.focus()
  }
  function requestNew() {
    confirmDiscard({
      when: !!current.drafts.length || !!text.trim(),
      title: '清空当前对话并重新开始？',
      description:
        '当前模式的对话、未保存草稿和未发送消息会被清除，另一个模式的内容会保留。',
      label: '清空并开始',
      action: startNew,
    })
  }
  function chooseTarget(account: Account, itemIndex: number, label: string) {
    const previous = conversations.capture
    const drafts = previous.drafts.map((draft, index) =>
      index === itemIndex
        ? draftFor(draft.item, currentData, defaultSubject, account, draft)
        : draft
    )
    const next = captureQuestion(drafts, currentData)
    update('capture', (value) => ({
      ...value,
      drafts,
      question: next,
      messages: [
        ...value.messages,
        message('user', label),
        message(
          'assistant',
          next?.text ?? '更新目标已确认。可以继续补充要改的内容，或核对后保存。'
        ),
      ],
    }))
    setText('')
    setError('')
  }
  async function save() {
    const generation = sessionEpoch()
    const drafts = conversations.capture.drafts
    setError('')
    if (
      text.trim() &&
      !/^(?:确认保存|确认提交|保存|提交)[。！!]?$/u.test(text.trim())
    ) {
      setError('还有未发送的补充，请返回对话发送，或清空输入后再保存')
      return
    }
    try {
      await commit((currentData) =>
        saveDrafts(currentData, drafts, engine === 'cloud' ? 'ai' : 'manual')
      )
      if (!mounted.current || generation !== sessionEpoch()) return
      update('capture', (value) => ({
        ...fresh('capture'),
        messages: [
          ...value.messages,
          message(
            'assistant',
            `已保存 ${drafts.length} 个账号，变更记录也已更新。还想记录其他账号吗？也可以切到查找继续查询。`
          ),
        ],
      }))
      setReview(false)
      setText('')
      toast.success(`已保存 ${drafts.length} 个账号`)
    } catch (e) {
      if (mounted.current && generation === sessionEpoch())
        setError(e instanceof Error ? e.message : '保存失败，草稿已保留')
    }
  }
  async function send(value = text) {
    const content = value.trim()
    if (!content || working || busy) return
    if (
      /^(?:确认保存|确认提交|保存|提交)[。！!]?$/u.test(content) &&
      mode === 'capture' &&
      current.drafts.length
    ) {
      if (question) {
        setError(question.text)
        return
      }
      setText('')
      await save()
      return
    }
    const nextMode = inferChatMode(content, mode)
    const previous = conversations[nextMode]
    const pendingQuestion =
      nextMode === 'capture'
        ? captureQuestion(previous.drafts, currentData)
        : null
    if (
      pendingQuestion?.field === 'target' &&
      pendingQuestion.targets?.length
    ) {
      const number = content.match(
        /^(?:第)?\s*([1-9]\d?|[一二三四五六七八九十])\s*(?:个|条)?[。]?$/
      )?.[1]
      const index = number
        ? /^\d+$/.test(number)
          ? Number(number) - 1
          : '一二三四五六七八九十'.indexOf(number)
        : -1
      const named = pendingQuestion.targets.filter(
        (a) => a.username.toLowerCase() === content.toLowerCase()
      )
      const selected =
        pendingQuestion.targets[index] ??
        (named.length === 1 ? named[0] : undefined)
      if (selected) {
        chooseTarget(selected, pendingQuestion.itemIndex ?? 0, content)
        return
      }
    }
    const turn: ChatTurn = {
      text: content,
      ...(pendingQuestion
        ? { field: pendingQuestion.field, itemIndex: pendingQuestion.itemIndex }
        : { field: nextMode === 'capture' ? 'details' : 'criteria' }),
    }
    const turns = [...previous.turns, turn]
    const context = {
      items: previous.drafts.map((d) => d.item),
      plan: previous.plan,
    }
    try {
      assertChatSafe(content)
      assertChatSafe(context)
      if (
        turns.length > MAX_CHAT_TURNS ||
        turns.reduce((sum, t) => sum + t.text.length, 0) > MAX_CHAT_CHARACTERS
      )
        throw new Error(
          '本次对话较长，请先保存当前草稿，或点击“新对话”重新开始'
        )
    } catch (e) {
      setError(e instanceof Error ? e.message : '请检查输入内容')
      return
    }
    const controller = new AbortController()
    request.current = controller
    const generation = sessionEpoch()
    setMode(nextMode)
    setText('')
    setError('')
    setWorking(true)
    setPendingText(content)
    follow.current = true
    setElapsed(0)
    setProgress(emptyProgress())
    let streamed = emptyProgress()
    const directChoice =
      nextMode === 'capture' &&
      !!pendingQuestion &&
      ((pendingQuestion.field === 'subject' &&
        (content === '暂不分配' ||
          currentData.subjects.some((subject) => subject.name === content))) ||
        (pendingQuestion.field === 'platform' &&
          pendingQuestion.choices?.includes(content)))
    try {
      const result =
        engine === 'cloud' && !directChoice
          ? chatResponseSchema.parse(
              await streamChat(
                chatRequestSchema.parse({
                  mode: nextMode,
                  turns,
                  context,
                  config: currentData.ai,
                  categories: currentData.categories,
                }),
                controller.signal,
                (event) => {
                  if (
                    !mounted.current ||
                    request.current !== controller ||
                    controller.signal.aborted ||
                    generation !== sessionEpoch()
                  )
                    return
                  if (event.type === 'status')
                    streamed =
                      event.phase === 'repairing'
                        ? { ...emptyProgress(), phase: 'repairing' }
                        : { ...streamed, phase: event.phase }
                  else if (event.type === 'thinking')
                    streamed = {
                      ...streamed,
                      phase: 'thinking',
                      thinking: (streamed.thinking + event.delta).slice(
                        0,
                        64000
                      ),
                    }
                  else
                    streamed = {
                      ...streamed,
                      phase: 'replying',
                      reply: event.text,
                    }
                  setProgress(streamed)
                }
              )
            )
          : chatResponseSchema.parse(
              localChat(nextMode, turn, context, currentData)
            )
      if (
        !mounted.current ||
        controller.signal.aborted ||
        generation !== sessionEpoch()
      )
        return
      if (result.mode !== nextMode)
        throw new Error('助手回复模式不正确，请重试')
      if (result.mode === 'capture') {
        const drafts = materializeDrafts(
          result.items,
          currentData,
          defaultSubject,
          previous.drafts
        )
        const next = captureQuestion(drafts, currentData)
        const reply = next?.text ?? '信息已补齐，可继续补充，或核对后保存。'
        update(nextMode, (old) => ({
          ...old,
          turns,
          drafts,
          question: next,
          messages: [
            ...old.messages,
            message('user', content),
            message(
              'assistant',
              [result.reply, reply].filter(Boolean).join('\n'),
              streamed.thinking
            ),
          ],
        }))
      } else {
        const found = searchFeedback(result.plan, currentData, content)
        update(nextMode, (old) => ({
          ...old,
          turns,
          plan: result.plan,
          choices: found.choices,
          messages: [
            ...old.messages,
            message('user', content),
            message(
              'assistant',
              [result.reply, found.message].filter(Boolean).join('\n'),
              streamed.thinking
            ),
          ],
        }))
      }
    } catch (e) {
      if (
        mounted.current &&
        generation === sessionEpoch() &&
        request.current === controller
      ) {
        setInput(nextMode, content)
        setError(
          controller.signal.aborted
            ? '已停止，本次输入和之前的草稿已保留'
            : e instanceof Error && e.name === 'ZodError'
              ? 'AI 回复格式不正确，当前草稿已保留，请重试'
              : e instanceof Error
                ? e.message
                : '回复失败，请重试'
        )
      }
    } finally {
      if (mounted.current && request.current === controller) {
        setWorking(false)
        setPendingText('')
        setProgress(emptyProgress())
        request.current = null
        input.current?.focus()
      }
    }
  }
  return (
    <Dialog
      open={!suspended}
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
    >
      <DialogContent
        className={`vault-dialog chat-dialog ${review ? 'chat-review-dialog' : ''}`}
        onEscapeKeyDown={onEscapeKeyDown}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className='dialog-title-icon'>
            <MessageCircle size={24} />
            {review ? '核对账号信息' : '拾钥 AI 助手'}
          </DialogTitle>
          <DialogDescription>
            {review
              ? '确认这次要保存的内容；返回对话还能继续补充。'
              : '想到什么就说什么，一起把账号信息整理完整。'}
          </DialogDescription>
        </DialogHeader>
        {!review ? (
          <>
            <div className='chat-tools'>
              <div className='composer-tabs'>
                <Button
                  variant='ghost'
                  className={mode === 'capture' ? 'active' : ''}
                  aria-pressed={mode === 'capture'}
                  disabled={working || busy}
                  onClick={() => switchMode('capture')}
                >
                  <Plus size={16} />
                  记录账号
                </Button>
                <Button
                  variant='ghost'
                  className={mode === 'search' ? 'active' : ''}
                  aria-pressed={mode === 'search'}
                  disabled={working || busy}
                  onClick={() => switchMode('search')}
                >
                  <Search size={16} />
                  查找账号
                </Button>
              </div>
              <Button
                variant='ghost'
                className='chat-reset'
                disabled={working || busy}
                onClick={requestNew}
                title='清除当前模式的对话和未保存草稿'
              >
                <RotateCcw size={15} />
                新对话
              </Button>
            </div>
            <div
              className={`chat-body ${mode === 'capture' && current.drafts.length ? 'has-drafts' : ''}`}
            >
              <div
                className='chat-scroll'
                ref={scroll}
                onScroll={() => {
                  const element = scroll.current
                  if (element)
                    follow.current =
                      element.scrollHeight -
                        element.scrollTop -
                        element.clientHeight <
                      64
                }}
              >
                <div
                  role='log'
                  aria-label='助手对话'
                  aria-live='polite'
                  aria-relevant='additions'
                  className='chat-messages'
                >
                  {current.messages.map((m) => (
                    <div key={m.id} className={`chat-message ${m.role}`}>
                      <span className='chat-speaker'>
                        {m.role === 'assistant' ? (
                          <>
                            <Sparkles size={14} />
                            拾钥助手
                          </>
                        ) : (
                          '你'
                        )}
                      </span>
                      {m.thinking && (
                        <details className='chat-thinking'>
                          <summary>查看模型思考</summary>
                          <div>{m.thinking}</div>
                        </details>
                      )}
                      <div className='chat-bubble'>{m.text}</div>
                    </div>
                  ))}
                  {working && (
                    <>
                      <div className='chat-message user'>
                        <span className='chat-speaker'>你</span>
                        <div className='chat-bubble'>{pendingText}</div>
                      </div>
                      <div className='chat-message assistant'>
                        <span className='chat-speaker'>
                          <Sparkles size={14} />
                          拾钥助手
                        </span>
                        <div className='chat-stream-status' role='status'>
                          <Busy
                            text={
                              engine === 'cloud'
                                ? phaseLabels[progress.phase]
                                : '正在整理…'
                            }
                          />
                          <span aria-hidden='true'>{elapsed} 秒</span>
                        </div>
                        {progress.thinking && (
                          <details
                            className='chat-thinking'
                            open={progress.phase === 'thinking'}
                          >
                            <summary>模型思考</summary>
                            <div aria-live='off'>{progress.thinking}</div>
                          </details>
                        )}
                        {progress.reply && (
                          <div className='chat-bubble' aria-live='off'>
                            {progress.reply}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
                {!working && (
                  <>
                    {question?.targets?.length ? (
                      <div
                        className='chat-targets'
                        aria-label='请选择要更新的账号'
                      >
                        {question.targets.slice(0, 20).map((account, index) => (
                          <Button
                            key={account.id}
                            variant='outline'
                            onClick={() =>
                              chooseTarget(
                                account,
                                question.itemIndex ?? 0,
                                `选择第 ${index + 1} 个账号`
                              )
                            }
                          >
                            <span>
                              <strong>
                                {index + 1}. {account.platform} ·{' '}
                                {account.username}
                              </strong>
                              <small>
                                {currentData.subjects.find(
                                  (s) => s.id === account.subjectId
                                )?.name ?? '未分配主体'}
                              </small>
                            </span>
                            <ChevronRight size={16} />
                          </Button>
                        ))}
                      </div>
                    ) : null}
                    <div className='chat-suggestions'>
                      {(
                        question?.choices ??
                        (mode === 'search' && feedback
                          ? feedback.choices
                          : current.turns.length
                            ? []
                            : mode === 'capture'
                              ? [
                                  '帮我记一个账号',
                                  'GitHub 账号是 hello@example.com，属于我个人',
                                ]
                              : [
                                  '查找所有云服务账号',
                                  '找出最近 7 天修改过密码的账号',
                                ])
                      ).map((choice) => (
                        <Button
                          key={choice}
                          variant='outline'
                          disabled={busy}
                          onClick={() => void send(choice)}
                        >
                          {choice}
                          <ArrowRight size={13} />
                        </Button>
                      ))}
                    </div>
                    {mode === 'search' && feedback && !feedback.asking && (
                      <section
                        className='ai-search-results'
                        aria-label='对话查询结果'
                      >
                        <div className='results-caption'>
                          <span>找到 {feedback.results.length} 个账号</span>
                          <small>仅在本机筛选</small>
                        </div>
                        <div className='search-plan-chips'>
                          {[
                            ...current.plan!.keywords,
                            current.plan!.subject,
                            current.plan!.category,
                            current.plan!.favorite === true
                              ? '已收藏'
                              : current.plan!.favorite === false
                                ? '未收藏'
                                : '',
                            current.plan!.status === 'active'
                              ? '使用中'
                              : current.plan!.status === 'inactive'
                                ? '已停用'
                                : current.plan!.status === 'pending'
                                  ? '待完善'
                                  : '',
                            current.plan!.changedField ? '指定字段有变更' : '',
                            current.plan!.updatedAfter
                              ? `自 ${new Date(current.plan!.updatedAfter).toLocaleDateString('zh-CN')}`
                              : '',
                          ]
                            .filter(Boolean)
                            .map((label, i) => (
                              <span key={i}>{label}</span>
                            ))}
                        </div>
                        {feedback.results.slice(0, 50).map((account) => (
                          <Button
                            key={account.id}
                            variant='ghost'
                            className='ai-search-result'
                            onClick={() => onSelect(account)}
                          >
                            <PlatformIcon account={account} small />
                            <span>
                              <strong>{account.platform}</strong>
                              <small>
                                {account.username} ·{' '}
                                {currentData.subjects.find(
                                  (s) => s.id === account.subjectId
                                )?.name ?? '未分配主体'}
                              </small>
                            </span>
                            <ArrowRight size={16} />
                          </Button>
                        ))}
                        {feedback.results.length > 50 && (
                          <p className='field-hint'>
                            先展示前 50 个账号，补充条件可以缩小范围。
                          </p>
                        )}
                      </section>
                    )}
                  </>
                )}
              </div>
              {mode === 'capture' && current.drafts.length > 0 && (
                <section
                  className={`chat-draft-preview ${draftExpanded ? 'expanded' : ''}`}
                  aria-busy={working}
                  aria-label='待保存的账号草稿'
                >
                  <div className='chat-preview-heading'>
                    <span>
                      <Check size={16} />
                      {ready ? '信息已补齐' : '正在补全'} ·{' '}
                      {current.drafts.length} 个账号
                    </span>
                    <small>尚未保存</small>
                  </div>
                  <Button
                    type='button'
                    variant='ghost'
                    className='chat-draft-toggle'
                    aria-expanded={draftExpanded}
                    onClick={() => setDraftExpanded(!draftExpanded)}
                  >
                    {draftExpanded ? '收起草稿详情' : '展开草稿详情'}
                  </Button>
                  <fieldset
                    className='chat-draft-details'
                    disabled={working || busy}
                  >
                    {current.drafts.map((draft, index) => (
                      <div className='chat-draft-summary' key={draft.id}>
                        <span className='chat-draft-index'>{index + 1}</span>
                        <div>
                          <strong>
                            {draft.account.platform || '平台待补充'}
                          </strong>
                          <span>{draft.account.username || '账号待补充'}</span>
                          <small>
                            {draft.subjectConfirmed
                              ? draft.account.subjectId === '__new__'
                                ? `${draft.subjectName}（新主体）`
                                : (currentData.subjects.find(
                                    (s) => s.id === draft.account.subjectId
                                  )?.name ?? '暂不分配主体')
                              : '主体待确认'}{' '}
                            ·{' '}
                            {draft.original
                              ? '更新已有账号'
                              : draft.needsTarget
                                ? '更新目标待确认'
                                : '新建账号'}
                          </small>
                        </div>
                      </div>
                    ))}
                    {current.drafts.length === 1 && ready && (
                      <PasswordField
                        label='密码（安全字段，可选）'
                        value={current.drafts[0].account.password}
                        onChange={(password) =>
                          setDrafts((ds) =>
                            ds.map((d) =>
                              patchDraft(d, { password }, currentData)
                            )
                          )
                        }
                        placeholder='仅在设备上使用，不会发送给模型'
                      />
                    )}
                  </fieldset>
                  <Button
                    className={ready ? 'primary-button' : ''}
                    variant={ready ? 'default' : 'outline'}
                    disabled={busy || working}
                    onClick={() => {
                      setReview(true)
                      setError('')
                    }}
                  >
                    {ready ? '核对并保存' : '查看并编辑草稿'}
                    <ArrowRight size={16} />
                  </Button>
                </section>
              )}
            </div>
            <form
              className='chat-composer'
              onSubmit={(event) => {
                event.preventDefault()
                void send()
              }}
            >
              {error && (
                <div className='form-error' role='alert'>
                  {error}
                </div>
              )}
              <label className='sr-only' htmlFor='assistant-message'>
                继续对话
              </label>
              <div className='chat-input-row'>
                <Textarea
                  id='assistant-message'
                  ref={input}
                  aria-label='发送给 AI 助手的消息'
                  placeholder={
                    question?.field === 'username'
                      ? '输入账号或登录标识…'
                      : mode === 'capture'
                        ? '继续补充，例如：备注改为生产环境…'
                        : '继续补充，例如：只看星河科技的…'
                  }
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={6000}
                  disabled={working || busy}
                  autoFocus
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing &&
                      e.nativeEvent.keyCode !== 229
                    ) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                />
                {working ? (
                  <Button
                    type='button'
                    variant='outline'
                    size='icon'
                    aria-label='停止回复'
                    onClick={(event) => {
                      event.preventDefault()
                      stopReply()
                    }}
                  >
                    <Square size={17} />
                  </Button>
                ) : (
                  <Button
                    type='submit'
                    className='primary-button'
                    size='icon'
                    aria-label='发送消息'
                    disabled={busy || !text.trim()}
                  >
                    <Send size={18} />
                  </Button>
                )}
              </div>
              <div className='chat-composer-options'>
                <FieldSelect
                  aria-label='助手处理方式'
                  value={engine}
                  disabled={working || busy}
                  onValueChange={setEngine}
                >
                  <FieldOption value='local'>本地助手</FieldOption>
                  <FieldOption
                    value='cloud'
                    disabled={!currentData.ai.apiKey || demo}
                  >
                    云端 AI{!currentData.ai.apiKey ? ' · 尚未配置' : ''}
                  </FieldOption>
                </FieldSelect>
                <span>
                  <LockKeyhole size={12} />
                  {engine === 'cloud'
                    ? '仅发送对话、非密码草稿与分类'
                    : '当前设备处理，无需联网'}
                </span>
              </div>
              <p className='chat-privacy-note'>
                对话在关闭或锁定后清除。密码请用安全字段填写。
              </p>
            </form>
          </>
        ) : (
          <>
            <div className='chat-review-scroll'>
              <AIDraftReview
                drafts={capture.drafts}
                setDrafts={setDrafts}
                currentData={currentData}
                defaultSubject={defaultSubject}
              />
            </div>
            {error && (
              <div className='form-error' role='alert'>
                {error}
              </div>
            )}
            <div className='chat-review-actions'>
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => {
                  setReview(false)
                  setError('')
                }}
              >
                <ArrowLeft size={16} />
                返回对话
              </Button>
              <Button
                className='primary-button'
                disabled={busy || !capture.drafts.length}
                onClick={() => void save()}
              >
                {busy ? (
                  <Busy text='正在加密保存…' />
                ) : (
                  <>
                    <Check size={17} />
                    确认保存 {capture.drafts.length} 个账号
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
      {!suspended && discardDialog}
    </Dialog>
  )
}
