import { useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Send,
  Square,
  MessageSquare,
  GraduationCap,
  Play,
  Sparkles,
  Database,
  SlidersHorizontal,
  ShieldAlert,
  Network,
  Layers,
} from 'lucide-react'
import { MessageItem } from '@/components/MessageItem'
import { retryQuestionOf } from '@/lib/sessions'
import { prefersReducedMotion, shouldPin } from '@/lib/utils'
import type { ChatMessage, Mode, StreamPhase } from '@/types'

/** qa 模式示例问题：取自知识库真实内容（03-rag-system / 02-prompt-engineering 等主题） */
const QA_EXAMPLES = [
  { icon: Database, text: '什么是 RAG？它解决了什么问题？' },
  { icon: SlidersHorizontal, text: 'Temperature、Top-P、Top-K 怎么调？' },
  { icon: ShieldAlert, text: '什么是 Prompt Injection？如何防御？' },
  { icon: Network, text: 'Transformer 的自注意力机制是怎么工作的？' },
] as const

/** interview 模式引导卡：点击切到面试模式、选中主题并直接开考 */
const INTERVIEW_GUIDES = [
  { icon: Database, title: 'RAG 专题面试', desc: '限定 03-rag-system 主题出题', topic: '03-rag-system' },
  { icon: Layers, title: 'Transformer 专题面试', desc: '限定 04-transformer-architecture 主题', topic: '04-transformer-architecture' },
] as const

/** 流式阶段提示：sse status 事件阶段 → 首 token 到达前展示的文案 */
const STAGE_HINT: Record<StreamPhase, string> = {
  retrieving: '正在检索知识库…',
  generating: '正在生成回答…',
  fallback: '本地模型不可用，使用知识库摘录回答…',
}

interface ChatAreaProps {
  messages: ChatMessage[]
  streaming: boolean
  streamingId: string | null
  /** 当前请求阶段（SSE status 事件），驱动流式阶段提示文案 */
  sendState: 'idle' | StreamPhase
  /** 当前会话 id：切换/恢复会话时重置滚动吸附并用 instant 定位到底部 */
  sessionId: string | null
  mode: Mode
  topic: string | null
  input: string
  onInputChange: (v: string) => void
  onSend: (text: string) => void
  onStop: () => void
  onStartInterview: () => void
  /** 选中主题的专题面试：切模式 + 选主题 + 发送「开始」 */
  onStartTopicInterview: (topic: string) => void
  /** 与消息配对的题目（assistant 消息 id → 题目），用于手动收藏错题 */
  pairedQuestions: Map<string, string>
  /** 错误消息的重试回调 */
  onRetry?: (failedMsgId: string) => void
}

export function ChatArea({
  messages,
  streaming,
  streamingId,
  sendState,
  sessionId,
  mode,
  topic,
  input,
  onInputChange,
  onSend,
  onStop,
  onStartInterview,
  onStartTopicInterview,
  pairedQuestions,
  onRetry,
}: ChatAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // 用户是否吸附在底部：向上翻阅历史时不再把视图拽回底部
  const pinnedRef = useRef(true)
  // 下一次滚动强制 instant：切换/恢复会话的定位跳转不该播平滑动画
  const forceAutoScrollRef = useRef(true)

  // 监听 ScrollArea viewport 的滚动，维护吸附状态
  useEffect(() => {
    const viewport = containerRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    if (!viewport) return
    const onScroll = () => {
      pinnedRef.current = shouldPin(viewport.scrollTop, viewport.clientHeight, viewport.scrollHeight)
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [])

  // 切换/恢复会话（含刷新恢复）：重置吸附，首次定位用 instant。
  // 声明在滚动 effect 之前，保证同一次提交里先置标记再滚动。
  useEffect(() => {
    pinnedRef.current = true
    forceAutoScrollRef.current = true
  }, [sessionId])

  // 仅吸附底部时跟随滚动；流式期间每 token 都用 instant（避免平滑动画反复重启），
  // 流结束（streaming false）的最后一次滚动才用 smooth；reduced-motion 全程 instant。
  useEffect(() => {
    if (!pinnedRef.current) return
    const behavior: ScrollBehavior =
      forceAutoScrollRef.current || streaming || prefersReducedMotion() ? 'auto' : 'smooth'
    forceAutoScrollRef.current = false
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' })
  }, [messages, streaming])

  // 输入框自动增高（上限由 max-h-40 约束）
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [input])

  // 所有用户主动发送/重试路径统一在这里 re-pin 到底部（示例卡、放弃看答案、重试、正常发送）
  const sendWithPin = useCallback(
    (text: string) => {
      pinnedRef.current = true
      onSend(text)
    },
    [onSend],
  )
  const retryWithPin = useCallback(
    (failedMsgId: string) => {
      pinnedRef.current = true
      onRetry?.(failedMsgId)
    },
    [onRetry],
  )

  const handleSend = () => {
    const text = input.trim()
    if (!text || streaming) return
    sendWithPin(text)
  }

  const empty = messages.length === 0

  // 面试模式：最后一条是 AI 出题/点评且不在生成中时，显示「不会，看答案解析」快捷按钮
  const last = messages[messages.length - 1]
  const showGiveUp =
    mode === 'interview' && !streaming && !!last && last.role === 'assistant' && !last.error

  return (
    <div ref={containerRef} className="flex min-w-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl px-4 py-6">
          {empty ? (
            <div className="flex flex-col items-center gap-8 pt-14 text-center">
              {/* 与 TopBar 重复的可见标题已移除，保留无障碍标题 */}
              <h1 className="sr-only">面试题库问答</h1>
              <div>
                <p className="mr-label mb-4">RAG · INTERVIEW BANK</p>
                <p className="text-sm text-muted-foreground">
                  基于本地知识库的检索增强问答，回答附引用来源与相关度评分。
                </p>
              </div>
              <div className="grid w-full max-w-xl gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-5 text-left transition-colors duration-200 hover:border-primary/50">
                  <div className="flex items-center gap-2 font-semibold text-foreground">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    问答模式
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    直接提问面试知识点，系统从题库检索相关分块并生成带引用的回答。点击左侧主题可快速填入提问。
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-card p-5 text-left transition-colors duration-200 hover:border-primary/50">
                  <div className="flex items-center gap-2 font-semibold text-foreground">
                    <GraduationCap className="h-4 w-4 text-primary" />
                    模拟面试模式
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    系统扮演面试官出题，你作答后会得到点评并进入下一题。可先在左侧选择主题限定出题范围。
                  </p>
                </div>
              </div>
              {mode === 'qa' ? (
                /* 示例问题卡：点击即填入并发送（参考 ChatGPT starter cards）；移动优先单列 */
                <div className="w-full max-w-xl">
                  <p className="mr-label mb-3 flex items-center justify-center gap-1.5">
                    <Sparkles className="h-3 w-3" />
                    试试这些问题
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {QA_EXAMPLES.map(({ icon: Icon, text }) => (
                      <button
                        key={text}
                        type="button"
                        onClick={() => sendWithPin(text)}
                        className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-4 text-left text-sm text-muted-foreground transition-colors duration-200 hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-primary" />
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* 面试引导卡：点击切模式 + 选主题 + 直接开考；移动优先单列 */
                <div className="flex w-full max-w-xl flex-col items-center gap-3">
                  <div className="grid w-full gap-3 sm:grid-cols-2">
                    {INTERVIEW_GUIDES.map(({ icon: Icon, title, desc, topic: t }) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onStartTopicInterview(t)}
                        className="rounded-xl border border-border bg-card p-4 text-left transition-colors duration-200 hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <Icon className="h-4 w-4 text-primary" />
                          {title}
                        </div>
                        <p className="mt-1.5 text-xs text-muted-foreground">{desc}</p>
                      </button>
                    ))}
                  </div>
                  <Button
                    size="lg"
                    onClick={onStartInterview}
                    className="glow-primary h-11 rounded-full px-8 font-semibold transition-all duration-200 hover:brightness-110"
                  >
                    <Play className="mr-2 h-4 w-4" />
                    综合模拟面试（不限主题）
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5" role="log" aria-live="polite" aria-label="对话消息">
              {messages.map((m) => (
                <MessageItem
                  key={m.id}
                  message={m}
                  streaming={streaming && m.id === streamingId}
                  stageHint={STAGE_HINT[sendState === 'idle' ? 'generating' : sendState]}
                  topic={topic}
                  pairedQuestion={pairedQuestions.get(m.id) ?? null}
                  onRetry={
                    // retryable:false 或无法确定原提问（旧数据 + hideUser 首问）的错误不提供重试入口
                    m.error && m.retryable !== false && onRetry && retryQuestionOf(messages, m.id)
                      ? retryWithPin
                      : undefined
                  }
                />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border bg-sidebar p-3">
        <div className="mx-auto max-w-3xl">
          {showGiveUp && (
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => sendWithPin('我不会这道题，请给出正确答案和解析')}
                className="rounded-full border border-border bg-transparent px-4 py-1.5 text-xs text-muted-foreground transition-colors duration-200 hover:border-primary/60 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                💡 不会，看答案解析
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={
              mode === 'interview'
                ? '输入你的回答（Enter 发送，Shift+Enter 换行）'
                : '输入你的问题（Enter 发送，Shift+Enter 换行）'
            }
            rows={1}
            className="max-h-40 min-h-[52px] flex-1 resize-none rounded-xl border-border bg-accent transition-shadow duration-200 focus-visible:border-primary/60 focus-visible:ring-primary/30"
          />
          {streaming ? (
            <Button
              variant="outline"
              onClick={onStop}
              className="h-[52px] rounded-full border-border bg-transparent px-5 text-muted-foreground transition-colors duration-200 hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-400"
            >
              <Square className="mr-1.5 h-4 w-4" />
              停止
            </Button>
          ) : (
            <Button
              onClick={handleSend}
              disabled={!input.trim()}
              className="glow-primary-sm h-[52px] rounded-full px-5 font-semibold transition-all duration-200 hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
            >
              <Send className="mr-1.5 h-4 w-4" />
              发送
            </Button>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}
