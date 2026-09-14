import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { TopBar } from '@/components/TopBar'
import { SidePanel, SidePanelContent } from '@/components/SidePanel'
import { ChatArea } from '@/components/ChatArea'
import { MistakesPanel } from '@/components/MistakesPanel'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { fetchHealth, fetchStats, streamChat } from '@/lib/api'
import {
  loadActiveId,
  loadSessions,
  makeTitle,
  removeSession,
  retryQuestionOf,
  saveActiveId,
  upsertSession,
} from '@/lib/sessions'
import {
  MISTAKES_CHANGED,
  addMistake,
  extractAnswer,
  extractQuestion,
  hasAnswerSection,
  loadMistakes,
} from '@/lib/mistakes'
import type { ChatMessage, Health, Mistake, Mode, Session, Stats, StreamPhase } from '@/types'

/** 发送时只携带最近 10 轮对话（一问一答共 20 条），防止长会话历史超出模型上下文 */
const HISTORY_LIMIT = 20

/** 请求生命周期：idle = 无进行中请求；其余值来自 SSE status 事件 */
type SendState = 'idle' | StreamPhase

function uid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [statsError, setStatsError] = useState(false)
  const [health, setHealth] = useState<Health | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('qa')
  const [topic, setTopic] = useState<string | null>(null)
  const [k, setK] = useState(5)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sendState, setSendState] = useState<SendState>('idle')
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const streaming = sendState !== 'idle'
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [mistakes, setMistakes] = useState<Mistake[]>([])
  const [mistakesOpen, setMistakesOpen] = useState(false)

  // 手动收藏错题的题答配对：assistant 消息 id → 该回答对应的题目
  // qa：该回答之前最近一条 user 消息的原文；interview：上一条非错误、非空 assistant
  // 消息里 extractQuestion 出的题目（与自动收录的取题口径一致，<4 字视为提取失败不配对）
  const pairedQuestions = useMemo(() => {
    const map = new Map<string, string>()
    let lastUser: string | null = null
    let lastAsst: ChatMessage | null = null
    for (const m of messages) {
      if (m.role === 'user') {
        lastUser = m.content
        continue
      }
      if (mode === 'qa') {
        if (lastUser !== null) map.set(m.id, lastUser)
      } else if (lastAsst) {
        const q = extractQuestion(lastAsst.content)
        if (q.length >= 4) map.set(m.id, q)
      }
      if (!m.error && m.content.trim()) lastAsst = m
    }
    return map
  }, [messages, mode])
  // 单请求所有权：同一时刻只允许一个进行中请求；id 单调递增，旧请求的回调/收尾全部失效
  const requestRef = useRef<{ id: number; ctrl: AbortController } | null>(null)
  const requestSeq = useRef(0)
  const activeIdRef = useRef<string | null>(null)
  // 标记"当前 messages 来自浏览恢复"，持久化 effect 对同一引用跳过，避免仅浏览就刷新 updatedAt
  const restoredMessagesRef = useRef<ChatMessage[] | null>(null)

  // 加载统计信息（失败不阻塞聊天）
  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch(() => setStatsError(true))
  }, [])

  // 健康状态（顶栏移动端圆点用；失败保持 null → 未知态，不影响聊天）
  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  // 错题本：初始加载 + 订阅变化（任何入口增删改都会实时刷新徽标计数）
  useEffect(() => {
    setMistakes(loadMistakes())
    const onChanged = () => setMistakes(loadMistakes())
    window.addEventListener(MISTAKES_CHANGED, onChanged)
    return () => window.removeEventListener(MISTAKES_CHANGED, onChanged)
  }, [])

  // 刷新后恢复上次的当前会话
  useEffect(() => {
    const list = loadSessions()
    setSessions(list)
    const wanted = loadActiveId()
    const active = list.find((s) => s.id === wanted) ?? list[0]
    if (active) {
      restoredMessagesRef.current = active.messages
      activeIdRef.current = active.id
      setActiveId(active.id)
      setMessages(active.messages)
      setMode(active.mode)
      setTopic(active.topic)
    }
  }, [])

  // 稳定终态落盘：仅写入空闲（无进行中请求）时的消息快照；纯失败会话（所有消息均为错误）不写存储。
  // 浏览器存储不可用时 toast 提示，不静默失败。
  const persistMessages = useCallback(
    (msgs: ChatMessage[]) => {
      if (msgs.length === 0) return
      if (msgs.every((m) => m.error)) return
      let id = activeIdRef.current
      if (!id) {
        id = uid()
        activeIdRef.current = id
        setActiveId(id)
      }
      const session: Session = {
        id,
        title: makeTitle(mode, topic, msgs),
        mode,
        topic,
        messages: msgs,
        updatedAt: Date.now(),
      }
      const { list, ok } = upsertSession(session)
      setSessions(list)
      saveActiveId(id)
      if (!ok) toast.error('会话保存失败：浏览器存储不可用')
    },
    [mode, topic],
  )

  // 空闲状态下消息/配置变化（含流式结束后的终态）自动持久化；
  // 流式过程中不落盘，避免把半截回答当成终态
  useEffect(() => {
    if (sendState !== 'idle') return
    if (messages === restoredMessagesRef.current) return // 浏览恢复，不刷新 updatedAt
    persistMessages(messages)
  }, [messages, sendState, persistMessages])

  const clearCurrent = useCallback(() => {
    requestRef.current?.ctrl.abort()
    requestRef.current = null // 旧请求 owns 全失效，其回调与 finally 自动跳过
    setSendState('idle') // 立即复位，不等被中断的 send() 走 finally
    setStreamingId(null)
    setMessages([])
    setInput('')
    restoredMessagesRef.current = null
    activeIdRef.current = null
    setActiveId(null)
    saveActiveId(null)
  }, [])

  const handleNewChat = useCallback(() => {
    clearCurrent() // 旧会话已持久化，保留在历史列表里
  }, [clearCurrent])

  const handleModeChange = useCallback(
    (m: Mode) => {
      // 恢复浏览中的会话发生配置变更：解除跳过标记，让变化可保存
      restoredMessagesRef.current = null
      if (messages.length === 0) {
        // 空对话：只切模式（topic 两种模式都支持，保留选择）
        setMode(m)
        return
      }
      // 非空对话：维持原逻辑，开启新会话
      clearCurrent()
      setMode(m)
    },
    [messages.length, clearCurrent],
  )

  const handleTopicClick = useCallback(
    (name: string) => {
      // 恢复浏览中的会话发生配置变更：解除跳过标记，让变化可保存
      restoredMessagesRef.current = null
      // qa / interview 两种模式都把主题作为检索过滤条件；再点一次取消
      setTopic((cur) => (cur === name ? null : name))
      if (mode === 'qa' && topic !== name) {
        setInput(`我想了解 ${name} 的内容`)
      }
    },
    [mode, topic],
  )

  const handleSelectSession = useCallback(
    (s: Session) => {
      if (s.id === activeIdRef.current) return
      requestRef.current?.ctrl.abort()
      requestRef.current = null // 旧请求 owns 全失效，其回调与 finally 自动跳过
      setSendState('idle') // 立即复位 loading 态，不等 finally
      setStreamingId(null)
      restoredMessagesRef.current = s.messages
      activeIdRef.current = s.id
      setActiveId(s.id)
      setMessages(s.messages)
      setMode(s.mode)
      setTopic(s.topic)
      setInput('')
      saveActiveId(s.id)
    },
    [],
  )

  const handleDeleteSession = useCallback(
    (id: string) => {
      const { list, ok } = removeSession(id)
      if (!ok) {
        // 写入失败时不动侧栏：否则侧栏消失、刷新后复现，用户毫无察觉
        toast.error('删除失败：浏览器存储不可用')
        return
      }
      setSessions(list)
      if (id === activeIdRef.current) {
        clearCurrent()
      }
    },
    [clearCurrent],
  )

  const send = useCallback(
    async (
      question: string,
      opts?: { hideUser?: boolean; modeOverride?: Mode; topicOverride?: string | null },
    ) => {
      // 单请求所有权：已有进行中请求时直接忽略（比 streaming state 更快，无闭包竞态）
      if (requestRef.current) return
      const reqId = ++requestSeq.current
      // 所有权谓词：abort/新对话/切换会话后 requestRef 被替换或清空，旧请求的所有回调失效
      const owns = () => requestRef.current?.id === reqId

      // 专题面试引导卡等场景需要在 setMode/setTopic 生效前就用新值发请求
      const effMode = opts?.modeOverride ?? mode
      const effTopic = opts?.topicOverride ?? topic
      const history = messages
        .filter((m) => !m.error && m.content.trim())
        .slice(-HISTORY_LIMIT)
        .map((m) => ({ role: m.role, content: m.content }))

      const userMsg: ChatMessage = { id: uid(), role: 'user', content: question }
      const asstId = uid()
      // requestQuestion 随会话持久化：错误重试据此绑定原请求，刷新后仍可用
      const asstMsg: ChatMessage = { id: asstId, role: 'assistant', content: '', requestQuestion: question }

      setMessages((prev) => (opts?.hideUser ? [...prev, asstMsg] : [...prev, userMsg, asstMsg]))
      setInput('')
      setSendState('retrieving') // 首个 status 事件前默认处于检索阶段
      setStreamingId(asstId)

      const ctrl = new AbortController()
      requestRef.current = { id: reqId, ctrl }

      // 所有状态变更先查所有权：已失效的旧请求不得碰新会话
      const patch = (fn: (m: ChatMessage) => ChatMessage) => {
        if (!owns()) return
        setMessages((prev) => prev.map((m) => (m.id === asstId ? fn(m) : m)))
      }

      // 本地累积流式内容：流结束后 state 可能尚未刷新，自动记录错题以这里为准
      let acc = ''
      let streamError = false

      try {
        await streamChat(
          {
            question,
            k,
            mode: effMode,
            topic: effTopic, // qa / interview 两种模式都传，后端按主题优先保留检索结果
            history,
          },
          ctrl.signal,
          {
            onStatus: (phase) => {
              if (owns()) setSendState(phase)
            },
            onSources: (sources) => patch((m) => ({ ...m, sources })),
            onToken: (content) => {
              acc += content
              patch((m) => ({ ...m, content: m.content + content }))
            },
            onError: (err) => {
              streamError = true
              // 追加而非覆盖：error 到达前可能已有部分 token 内容
              patch((m) => ({
                ...m,
                content: m.content
                  ? `${m.content}\n\n⚠️ 后端错误：${err.message}`
                  : `后端错误：${err.message}`,
                error: true,
                errorCode: err.code,
                retryable: err.retryable,
              }))
            },
            onDone: () => {},
          },
        )

        // 面试模式自动记录错题：回复流式正常完成且包含「### 正确答案」小节
        // （abort / error 事件 / 请求异常 / 请求已失效都不会走到这里）
        if (owns() && effMode === 'interview' && !streamError && hasAnswerSection(acc)) {
          // 被回答的题在「上一条 assistant 消息」里（send 闭包捕获的是发送前的消息列表）
          const prevAsst = [...messages]
            .reverse()
            .find((m) => m.role === 'assistant' && !m.error && m.content.trim())
          if (prevAsst) {
            const q = extractQuestion(prevAsst.content)
            // 太短的「题目」是提取失败的残留（如空「下一题：」尾巴），不记录
            if (q.length >= 4) {
              const { isNew, ok } = addMistake({
                question: q,
                answer: extractAnswer(acc),
                topic: effTopic,
              })
              if (ok) {
                toast(isNew ? '已自动收录到错题本' : '错题本已刷新该题记录', {
                  icon: '📕',
                })
              } else {
                toast.error('错题本保存失败：浏览器存储不可用')
              }
            }
          }
        }
      } catch (e) {
        if (!owns()) return // 旧请求：终态与收尾都由当前请求（或 clearCurrent）负责
        if ((e as Error).name === 'AbortError') {
          // 手动停止：已有部分内容时追加标记，便于和正常完成区分
          patch((m) => ({
            ...m,
            content: m.content.trim() ? `${m.content}\n\n_（已手动停止）_` : m.content,
            stopped: true,
          }))
        } else {
          // 追加而非覆盖：异常前可能已有部分 token 内容
          patch((m) => ({
            ...m,
            content: m.content
              ? `${m.content}\n\n⚠️ 请求失败：${e instanceof Error ? e.message : String(e)}`
              : `请求失败：${e instanceof Error ? e.message : String(e)}`,
            error: true,
            retryable: true,
          }))
        }
      } finally {
        // 旧请求的收尾全部跳过：状态由当前请求（或 clearCurrent）负责。
        // 稳定终态落盘不在此处做：setSendState('idle') 与最后的 patch 同批提交，
        // 持久化 effect 在 idle 转换后读到最新 messages，是唯一落盘路径。
        if (owns()) {
          requestRef.current = null
          setSendState('idle')
          setStreamingId(null)
        }
      }
    },
    [messages, k, mode, topic],
  )

  const handleStop = useCallback(() => {
    // 只 abort：收尾（停止标记/状态复位/落盘）由 send 的 catch/finally 完成
    requestRef.current?.ctrl.abort()
  }, [])

  // 错误消息重试：移除错误占位后重发该消息绑定的原问题（requestQuestion，或前一条 user 消息）。
  // 原用户消息仍在列表里，故 hideUser 避免重复气泡（面试开场景本无用户消息，同样成立）
  const handleRetry = useCallback(
    (failedMsgId: string) => {
      if (requestRef.current) return
      const question = retryQuestionOf(messages, failedMsgId)
      if (!question) return
      setMessages((prev) => prev.filter((m) => m.id !== failedMsgId))
      void send(question, { hideUser: true })
    },
    [messages, send],
  )

  const handleStartInterview = useCallback(() => {
    // “开始”是触发信号，不作为用户消息展示/存储
    void send('开始', { hideUser: true })
  }, [send])

  // 空状态引导卡：切到 interview + 选中专题 + 直接开考
  // （mode/topic 的 state 更新不会同步进 send 闭包，故用 override 传值）
  const handleStartTopicInterview = useCallback(
    (t: string) => {
      setMode('interview')
      setTopic(t)
      void send('开始', { hideUser: true, modeOverride: 'interview', topicOverride: t })
    },
    [send],
  )

  // 错题本「再考我一次」：新建 interview 会话，预置该题为面试官刚出的题
  const handleRetryMistake = useCallback(
    (m: Mistake) => {
      setMistakesOpen(false)
      clearCurrent() // 会同时清掉 restoredMessagesRef —— 这是主动新建的会话，应被持久化
      setMode('interview')
      setTopic(m.topic)
      setMessages([{ id: uid(), role: 'assistant', content: m.question }])
      toast('已开考：请在下方作答', { icon: '🎯' })
    },
    [clearCurrent],
  )

  const sidePanelProps = {
    mode,
    onModeChange: handleModeChange,
    topics: stats?.topics ?? [],
    selectedTopic: topic,
    onTopicClick: handleTopicClick,
    onNewChat: handleNewChat,
    sessions,
    activeSessionId: activeId,
    onSelectSession: handleSelectSession,
    onDeleteSession: handleDeleteSession,
    mistakesCount: mistakes.length,
    onOpenMistakes: () => setMistakesOpen(true),
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <TopBar
        stats={stats}
        health={health}
        statsError={statsError}
        k={k}
        onKChange={setK}
        onOpenMobileNav={() => setMobileNavOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <SidePanel {...sidePanelProps} />
        <ChatArea
          messages={messages}
          streaming={streaming}
          streamingId={streamingId}
          sendState={sendState}
          sessionId={activeId}
          mode={mode}
          topic={topic}
          input={input}
          onInputChange={setInput}
          onSend={(text) => void send(text)}
          onStop={handleStop}
          onStartInterview={handleStartInterview}
          onStartTopicInterview={handleStartTopicInterview}
          pairedQuestions={pairedQuestions}
          onRetry={handleRetry}
        />
      </div>

      {/* 移动端导航抽屉：与桌面 aside 共用同一份 SidePanelContent；选择会话/主题后自动关闭 */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 gap-0 border-r border-border bg-sidebar p-0 pt-12">
          <SheetTitle className="sr-only">导航菜单</SheetTitle>
          <SidePanelContent
            {...sidePanelProps}
            onSelectSession={(s) => {
              handleSelectSession(s)
              setMobileNavOpen(false)
            }}
            onTopicClick={(name) => {
              handleTopicClick(name)
              setMobileNavOpen(false)
            }}
            onNewChat={() => {
              handleNewChat()
              setMobileNavOpen(false)
            }}
            onOpenMistakes={() => {
              setMistakesOpen(true)
              setMobileNavOpen(false)
            }}
          />
        </SheetContent>
      </Sheet>

      <MistakesPanel
        open={mistakesOpen}
        onOpenChange={setMistakesOpen}
        mistakes={mistakes}
        onRetry={handleRetryMistake}
      />
    </div>
  )
}
