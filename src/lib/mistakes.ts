import type { Mistake } from '@/types'
import type { PersistResult } from './sessions'

const MISTAKES_KEY = 'rag-qa:mistakes'
export const MAX_MISTAKES = 100

/** 错题本变化时派发的事件名（供徽标计数等订阅刷新） */
export const MISTAKES_CHANGED = 'rag-qa:mistakes-changed'

export function loadMistakes(): Mistake[] {
  try {
    const raw = localStorage.getItem(MISTAKES_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as Mistake[]
    if (!Array.isArray(list)) return []
    return list
      .filter((m) => m && typeof m.id === 'string' && typeof m.question === 'string')
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

function persist(list: Mistake[]): PersistResult<Mistake> {
  const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt)
  const trimmed = sorted.slice(0, MAX_MISTAKES) // 容量保护：最多 100 条，删最旧
  let ok = true
  try {
    localStorage.setItem(MISTAKES_KEY, JSON.stringify(trimmed))
  } catch {
    // 存储满等异常：不阻塞聊天，但必须让调用方知道写入失败
    ok = false
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MISTAKES_CHANGED))
  }
  return { list: trimmed, ok }
}

function normalizeQuestion(q: string): string {
  return q.replace(/\s+/g, ' ').trim()
}

export interface AddMistakeInput {
  question: string
  answer: string
  topic: string | null
}

export interface AddMistakeResult {
  list: Mistake[]
  mistake: Mistake
  /** true = 新收录；false = 已在错题本，刷新了已有记录 */
  isNew: boolean
  /** false = localStorage 写入失败（内存列表仍已更新） */
  ok: boolean
}

/**
 * 收录一道错题。按归一化后的 question 文本去重：
 * 重复答错/重复收藏时不新增，而是刷新 createdAt、reviewCount +1，
 * 并在新 answer 非空时覆盖旧 answer。topic 总是以新值为准
 * （允许重复收藏把主题改回 null「综合」）。
 */
export function addMistake(input: AddMistakeInput): AddMistakeResult {
  const question = normalizeQuestion(input.question)
  const answer = input.answer.trim()
  const now = Date.now()
  const loaded = loadMistakes()
  const existing = loaded.find((m) => normalizeQuestion(m.question) === question)

  if (existing) {
    const updated: Mistake = {
      ...existing,
      answer: answer || existing.answer,
      topic: input.topic,
      createdAt: now,
      reviewCount: existing.reviewCount + 1,
    }
    const { list, ok } = persist([updated, ...loaded.filter((m) => m.id !== existing.id)])
    return { list, mistake: updated, isNew: false, ok }
  }

  const mistake: Mistake = {
    id:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${now}-${Math.random().toString(36).slice(2)}`,
    question,
    answer,
    topic: input.topic,
    createdAt: now,
    reviewCount: 0,
  }
  const { list, ok } = persist([mistake, ...loaded])
  return { list, mistake, isNew: true, ok }
}

export function removeMistake(id: string): PersistResult<Mistake> {
  return persist(loadMistakes().filter((m) => m.id !== id))
}

/** 「还不熟」：复习次数 +1，更新 lastReviewAt */
export function markReview(id: string): PersistResult<Mistake> {
  const now = Date.now()
  return persist(
    loadMistakes().map((m) =>
      m.id === id ? { ...m, reviewCount: m.reviewCount + 1, lastReviewAt: now } : m,
    ),
  )
}

// ---------- 筛选与排序（MistakesPanel 用，纯函数便于单测） ----------

/**
 * 按主题筛选错题。
 * - undefined：全部主题
 * - null：仅「综合」（未限定主题的错题）
 * - 字符串：指定主题
 */
export function filterMistakes(
  list: Mistake[],
  topic: string | null | undefined,
): Mistake[] {
  if (topic === undefined) return list
  return list.filter((m) => m.topic === topic)
}

export type MistakeSortBy = 'recent' | 'reviewCount'

/** 排序：recent = 最近记录优先；reviewCount = 复习次数多优先（并列时新的在前）。返回新数组。 */
export function sortMistakes(list: Mistake[], by: MistakeSortBy): Mistake[] {
  const sorted = [...list]
  if (by === 'reviewCount') {
    sorted.sort((a, b) => b.reviewCount - a.reviewCount || b.createdAt - a.createdAt)
  } else {
    sorted.sort((a, b) => b.createdAt - a.createdAt)
  }
  return sorted
}

/** 错题里实际出现过的主题列表（含 null = 综合），按名称排序，null 排最后 */
export function mistakeTopics(list: Mistake[]): (string | null)[] {
  const set = new Set(list.map((m) => m.topic))
  return [...set].sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
}

// ---------- 题目 / 答案提取（自动记录与手动收藏共用） ----------

// 小模型输出格式不稳定，以下正则要容忍这些变体：
//   标题级别：### / ## / #### / 无 #
//   加粗：**正确答案**、**下一题：**
//   冒号：全角：/ 半角:
//   标题行内带内容：### 正确答案：xxx
const ANSWER_RE = /(?:^|\n)[ \t]*#{0,4}[ \t]*\*{0,2}正确答案\*{0,2}是?[：:]?/
const NEXT_Q_RE = /(?:^|\n)[ \t]*#{0,4}[ \t]*\*{0,2}下一题\*{0,2}[：:]/g

/**
 * 清理提取出的答案文本：
 * - 去掉连续的空标题行（如 "### 正确答案\n### 解析" 这种小模型常见的空标题堆叠）
 * - 去掉首尾的分隔线 ---
 */
function cleanupAnswer(text: string): string {
  const lines = text.split('\n')
  const kept: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^[ \t]*#{1,4}[ \t]*\S/.test(line)) {
      // 标题行：若下一个非空行也是标题，则当前是空标题，丢弃
      const nextContent = lines.slice(i + 1).find((l) => l.trim() !== '')
      if (nextContent && /^[ \t]*#{1,4}[ \t]*\S/.test(nextContent)) continue
    }
    kept.push(line)
  }
  return kept
    .join('\n')
    .replace(/^(?:\s*---\s*)+/, '')
    .replace(/(?:\s*---\s*)+$/, '')
    .trim()
}

/**
 * 从一条 assistant 消息提取「被回答的题目」：
 * - 有「下一题：」时，取最后一个「后面跟着实质题目（≥4 字）」的匹配之后的文本；
 *   小模型偶尔会输出一个没有题目的「下一题：」尾巴，这种匹配要跳过。
 * - 完全没有「下一题：」时取整条消息（面试首问的场景）。
 * - 有「下一题：」但都没有实质题目时返回空串（调用方应放弃记录）。
 */
export function extractQuestion(content: string): string {
  NEXT_Q_RE.lastIndex = 0
  let m: RegExpExecArray | null
  const matches: { index: number; len: number }[] = []
  while ((m = NEXT_Q_RE.exec(content)) !== null) {
    matches.push({ index: m.index, len: m[0].length })
  }
  if (matches.length > 0) {
    // 从后往前找第一个「到下一个匹配（或文末）之间有实质题目（≥4 字）」的匹配，
    // 小模型偶尔会输出一个没有题目的「下一题：」尾巴，要跳过
    for (let i = matches.length - 1; i >= 0; i--) {
      const start = matches[i].index + matches[i].len
      const end = i + 1 < matches.length ? matches[i + 1].index : content.length
      const after = content
        .slice(start, end)
        .replace(/^[*\s>#]+/, '')
        .trim()
      if (after.length >= 4) return after
    }
    return ''
  }
  return content.replace(/^[*\s>]+/, '').trim()
}

/**
 * 从一条 assistant 回复提取「正确答案」到「下一题：」（或文末）之间的内容。
 * 没有正确答案小节时返回空字符串。
 */
export function extractAnswer(content: string): string {
  const start = content.search(ANSWER_RE)
  if (start < 0) return ''
  const rest = content.slice(start)
  NEXT_Q_RE.lastIndex = 0
  const end = rest.search(NEXT_Q_RE)
  return cleanupAnswer(end >= 0 ? rest.slice(0, end) : rest)
}

/** 该回复是否包含可自动记录的正确答案小节 */
export function hasAnswerSection(content: string): boolean {
  return ANSWER_RE.test(content)
}
