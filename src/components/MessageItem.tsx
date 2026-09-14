import { useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { toast } from 'sonner'
import { AlertTriangle, BookmarkPlus, Bot, Check, Copy, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SCORE_LOW } from '@/lib/constants'
import { linkifyCitations, scrollToCitationAnchor, sourceAnchorId } from '@/lib/citations'
import { SourceCard } from '@/components/SourceCard'
import { Spinner } from '@/components/ui/spinner'
import { addMistake, extractAnswer, extractQuestion } from '@/lib/mistakes'
import type { ChatMessage } from '@/types'

interface MessageItemProps {
  message: ChatMessage
  streaming: boolean
  /** 当前会话选中的主题（手动收藏错题时记录用） */
  topic: string | null
  /** 与该消息配对的题目（QA=最近 user 消息原文；interview=被回答的题目），null 时回退到从内容提取 */
  pairedQuestion: string | null
  /** 错误消息的重试回调 */
  onRetry?: (failedMsgId: string) => void
  /** 流式阶段提示（retrieving/generating/fallback 文案）；仅 streaming 且尚无内容时显示 */
  stageHint?: string | null
}

/** markdown 链接渲染：#source- 开头的引用锚点改为平滑滚动 + 高亮目标卡片；http(s) 外链新窗口打开 */
const markdownComponents: Components = {
  a: ({ href, children }) => {
    if (href?.startsWith('#source-')) {
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault()
            scrollToCitationAnchor(href.slice(1))
          }}
        >
          {children}
        </a>
      )
    }
    if (href && /^https?:\/\//.test(href)) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      )
    }
    return <a href={href}>{children}</a>
  },
}

export function MessageItem({ message, streaming, topic, pairedQuestion, onRetry, stageHint }: MessageItemProps) {
  const isUser = message.role === 'user'
  const sources = message.sources ?? []
  const [copied, setCopied] = useState(false)
  const lowScore =
    !isUser && sources.length > 0 && sources.every((s) => s.score < SCORE_LOW)

  const handleSaveMistake = () => {
    const question = (pairedQuestion ?? extractQuestion(message.content)).trim()
    if (question.length < 4) {
      toast.error('无法识别对应题目，未收录')
      return
    }
    // QA 回答没有「正确答案」小节，整段内容就是答案
    const answer = extractAnswer(message.content) || message.content.trim()
    const { isNew, ok } = addMistake({ question, answer, topic })
    if (!ok) {
      toast.error('保存失败：浏览器存储不可用')
      return
    }
    if (isNew) {
      toast.success('已加入错题本')
    } else {
      toast('该题已在错题本，已刷新记录')
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      toast.success('已复制 Markdown 原文')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('复制失败，请手动选择文本复制')
    }
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[80%] items-start gap-2">
          <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm leading-relaxed font-medium whitespace-pre-wrap text-primary-foreground">
            {message.content}
          </div>
          <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
            <User className="h-4 w-4 text-primary" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex justify-start">
      <div className="flex max-w-[85%] items-start gap-2">
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-accent">
          <Bot className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {lowScore && (
            <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              检索到的资料相关度较低，回答可能不准确
            </div>
          )}

          <div
            className={cn(
              'rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm',
              message.error
                ? 'border border-red-500/30 bg-red-500/10 text-red-400'
                : 'border border-border bg-card',
            )}
          >
            {message.error ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : streaming && !message.content && stageHint ? (
              /* 首个 token 到达前：按 sendState 显示阶段提示 */
              <div className="flex items-center gap-2 text-muted-foreground">
                <Spinner className="size-3.5" />
                <span>{stageHint}</span>
              </div>
            ) : (
              <div className="markdown-body">
                <ReactMarkdown components={markdownComponents}>
                  {linkifyCitations(message.content, message.id, sources.length)}
                </ReactMarkdown>
                {streaming && (
                  // 流式光标：发光仅暗色生效（glow-primary-sm）
                  <span className="glow-primary-sm ml-0.5 inline-block h-4 w-2 animate-pulse rounded-[1px] bg-primary align-text-bottom" />
                )}
              </div>
            )}
          </div>

          {/* 错误消息的重试入口；无原提问可绑定时由 ChatArea 不传 onRetry */}
          {message.error && !streaming && onRetry && (
            <button
              type="button"
              onClick={() => onRetry?.(message.id)}
              className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs text-red-300 transition-colors duration-150 hover:bg-red-500/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              重试
            </button>
          )}

          {sources.length > 0 && (
            <div className="space-y-1.5">
              <p className="mr-label">SOURCES · 引用资料（{sources.length}）</p>
              {sources.map((s, i) => (
                <div key={`${s.source}-${i}`} id={sourceAnchorId(message.id, i)}>
                  <SourceCard source={s} index={i} />
                </div>
              ))}
            </div>
          )}

          {/* 无来源的中性提示：回答生成完毕、非错误、有内容但未检索到资料 */}
          {sources.length === 0 && !streaming && !message.error && message.content.trim() && (
            <p className="rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
              本次回答未检索到可用知识库资料
            </p>
          )}

          {!streaming && !message.error && message.content.trim() && (
            /* hover 操作条（参考 ChatGPT）：复制 + 加入错题本；移动端常显，桌面 hover/focus-within 显现 */
            <div className="flex items-center gap-1 opacity-100 transition-opacity duration-150 focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
              <button
                type="button"
                onClick={() => void handleCopy()}
                title="复制 Markdown 原文"
                aria-label="复制 Markdown 原文"
                className="rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={handleSaveMistake}
                title="加入错题本"
                aria-label="加入错题本"
                className="rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <BookmarkPlus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
