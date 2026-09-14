import type { ChatRequest, Health, KnowledgeMeta, Stats } from '@/types'
import { consumeSSE } from './sse.mjs'
import type { StreamHandlers } from './sse.mjs'

const API_BASE = ''

export async function fetchStats(): Promise<Stats> {
  const res = await fetch(`${API_BASE}/api/stats`)
  if (!res.ok) {
    throw new Error(`GET /api/stats 失败：HTTP ${res.status}`)
  }
  const data: unknown = await res.json()
  if (!isStats(data)) {
    throw new Error('GET /api/stats 返回格式异常')
  }
  return data
}

function isStats(data: unknown): data is Stats {
  if (!data || typeof data !== 'object') return false
  if (!('chunks' in data) || typeof data.chunks !== 'number') return false
  if (!('topics' in data) || !Array.isArray(data.topics)) return false
  return true
}

export async function fetchHealth(): Promise<Health> {
  const res = await fetch(`${API_BASE}/api/health`)
  if (!res.ok) {
    throw new Error(`GET /api/health 失败：HTTP ${res.status}`)
  }
  return (await res.json()) as Health
}

export async function fetchMeta(): Promise<KnowledgeMeta> {
  const res = await fetch(`${API_BASE}/api/meta`)
  if (!res.ok) {
    throw new Error(`GET /api/meta 失败：HTTP ${res.status}`)
  }
  const data: unknown = await res.json()
  if (!isKnowledgeMeta(data)) {
    throw new Error('GET /api/meta 返回格式异常')
  }
  return data
}

function isKnowledgeMeta(data: unknown): data is KnowledgeMeta {
  if (!data || typeof data !== 'object') return false
  if (!('kbId' in data) || typeof data.kbId !== 'string') return false
  if (!('appName' in data) || typeof data.appName !== 'string') return false
  if (!('modes' in data) || !Array.isArray(data.modes)) return false
  return true
}

/**
 * POST /api/chat，后端返回 text/event-stream。
 * 不能用 EventSource（仅支持 GET），故用 fetch + getReader 手动解析。
 * 帧解析逻辑在 ./sse.mjs（纯 JS，便于 Node 下单测）。
 */
export async function streamChat(
  req: ChatRequest,
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  })
  if (!res.ok) {
    throw new Error(`POST /api/chat 失败：HTTP ${res.status}`)
  }
  if (!res.body) {
    throw new Error('响应没有 body，无法读取流')
  }
  await consumeSSE(res.body, handlers)
}
