export type Mode = 'qa' | 'interview'

export interface Topic {
  name: string
  count: number
}

export interface Stats {
  chunks: number
  llm_model: string
  embed_model: string
  topics: Topic[]
}

export interface Source {
  title: string
  text: string
  source: string
  score: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  error?: boolean
  /** 流被手动停止（abort）的标记 */
  stopped?: boolean
  /** 结构化后端错误码（SSE error 事件） */
  errorCode?: string
  /** 该错误是否可重试 */
  retryable?: boolean
  /** 触发这条 assistant 消息的原始提问（随会话持久化，错误重试绑定原请求用） */
  requestQuestion?: string
}

export interface ChatRequest {
  question: string
  k: number
  mode: Mode
  topic: string | null
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface Session {
  id: string
  title: string
  mode: Mode
  topic: string | null
  messages: ChatMessage[]
  updatedAt: number
}

export interface Mistake {
  id: string
  question: string
  /** 正确答案 + 解析原文；手动收藏无答案小节的消息时为空字符串 */
  answer: string
  /** 会话选中的主题；null 表示未限定（UI 显示「综合」） */
  topic: string | null
  createdAt: number
  reviewCount: number
  lastReviewAt?: number
}

export type StreamPhase = 'retrieving' | 'generating' | 'fallback'

export interface StreamError {
  code: string
  message: string
  retryable: boolean
}

export type SSEEvent =
  | { type: 'status'; phase: StreamPhase }
  | { type: 'sources'; sources: Source[] }
  | { type: 'token'; content: string }
  | { type: 'done' }
  | ({ type: 'error' } & StreamError)

export interface Health {
  status: 'ready' | 'degraded' | 'unavailable'
  index: { ok: boolean; chunks: number; error: string | null }
  llm: { ok: boolean; model: string; base: string; error: string | null }
}
