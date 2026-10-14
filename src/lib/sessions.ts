import type { ChatMessage, Mode, Session } from '@/types'

/** localStorage 命名空间：rag-chat-ui:{kbId}:{kind}，不同知识库的会话/错题互不串数据 */
export type StorageKind = 'sessions' | 'active' | 'mistakes'

export function storageKey(kind: StorageKind, kbId: string): string {
  return `rag-chat-ui:${kbId}:${kind}`
}

/** 未拿到 meta.kbId 时的兜底命名空间（meta 加载完成前不应读写，见 Home） */
const DEFAULT_KB_ID = 'default'

export const MAX_SESSIONS = 50

export function loadSessions(kbId: string = DEFAULT_KB_ID): Session[] {
  try {
    const raw = localStorage.getItem(storageKey('sessions', kbId))
    if (!raw) return []
    const list = JSON.parse(raw) as Session[]
    if (!Array.isArray(list)) return []
    return list
      .filter((s) => s && typeof s.id === 'string' && Array.isArray(s.messages))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export interface PersistResult<T> {
  list: T[]
  /** false = localStorage 写入失败（内存列表仍已更新，调用方应提示用户） */
  ok: boolean
}

function persist(list: Session[], kbId: string): PersistResult<Session> {
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt)
  const trimmed = sorted.slice(0, MAX_SESSIONS) // 容量保护：最多 50 个，删最旧
  try {
    localStorage.setItem(storageKey('sessions', kbId), JSON.stringify(trimmed))
    return { list: trimmed, ok: true }
  } catch {
    // 存储满等异常：不阻塞聊天，但必须让调用方知道写入失败
    return { list: trimmed, ok: false }
  }
}

export function upsertSession(session: Session, kbId: string = DEFAULT_KB_ID): PersistResult<Session> {
  const list = loadSessions(kbId).filter((s) => s.id !== session.id)
  list.unshift(session)
  return persist(list, kbId)
}

export function removeSession(id: string, kbId: string = DEFAULT_KB_ID): PersistResult<Session> {
  return persist(
    loadSessions(kbId).filter((s) => s.id !== id),
    kbId,
  )
}

export function loadActiveId(kbId: string = DEFAULT_KB_ID): string | null {
  try {
    return localStorage.getItem(storageKey('active', kbId))
  } catch {
    return null
  }
}

export function saveActiveId(id: string | null, kbId: string = DEFAULT_KB_ID): void {
  try {
    const key = storageKey('active', kbId)
    if (id) localStorage.setItem(key, id)
    else localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/** 会话标题：首条用户消息前 20 字；面试模式首条是“开始”（或没有用户消息）时用首条 AI 内容 / 主题名 */
export function makeTitle(mode: Mode, topic: string | null, messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')
  if (mode === 'interview') {
    if (firstUser && firstUser.content !== '开始') return firstUser.content.slice(0, 20)
    const firstAsst = messages.find((m) => m.role === 'assistant' && !m.error && m.content.trim())
    if (firstAsst) return firstAsst.content.replace(/\s+/g, ' ').slice(0, 20)
    return topic ? `模拟面试 · ${topic}` : '模拟面试'
  }
  if (firstUser) return firstUser.content.slice(0, 20)
  return '新对话'
}

/**
 * 错误重试对应的原提问：优先读发送时持久化在消息上的 requestQuestion，
 * 否则向前找最近一条 user 消息；都没有（如恢复的旧数据 + hideUser 首问）返回 null。
 */
export function retryQuestionOf(messages: ChatMessage[], failedMsgId: string): string | null {
  const idx = messages.findIndex((m) => m.id === failedMsgId)
  if (idx < 0) return null
  const failed = messages[idx]
  if (!failed.error) return null
  if (failed.requestQuestion) return failed.requestQuestion
  for (let i = idx - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user' && m.content.trim()) return m.content
  }
  return null
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return new Date(ts).toLocaleDateString()
}
