// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_SESSIONS,
  loadActiveId,
  loadSessions,
  makeTitle,
  relativeTime,
  removeSession,
  saveActiveId,
  storageKey,
  upsertSession,
} from './sessions'
import type { ChatMessage, Session } from '@/types'

function makeSession(id: string, updatedAt: number, messages: ChatMessage[] = []): Session {
  return { id, title: `会话 ${id}`, mode: 'qa', topic: null, messages, updatedAt }
}

beforeEach(() => {
  localStorage.clear()
})

describe('storageKey / kbId 隔离', () => {
  it('key 形如 rag-chat-ui:{kbId}:{kind}', () => {
    expect(storageKey('sessions', 'kb-a')).toBe('rag-chat-ui:kb-a:sessions')
    expect(storageKey('active', 'kb-a')).toBe('rag-chat-ui:kb-a:active')
    expect(storageKey('mistakes', 'kb-a')).toBe('rag-chat-ui:kb-a:mistakes')
  })

  it('不同 kbId 的会话互不可见', () => {
    upsertSession(makeSession('a', 1000), 'kb-a')
    upsertSession(makeSession('b', 2000), 'kb-b')
    expect(loadSessions('kb-a').map((s) => s.id)).toEqual(['a'])
    expect(loadSessions('kb-b').map((s) => s.id)).toEqual(['b'])
    // 未指定 kbId 时落到 default 命名空间，读不到他人数据
    expect(loadSessions()).toEqual([])
  })

  it('removeSession 只影响指定 kbId', () => {
    upsertSession(makeSession('a', 1000), 'kb-a')
    upsertSession(makeSession('a', 1000), 'kb-b')
    removeSession('a', 'kb-a')
    expect(loadSessions('kb-a')).toEqual([])
    expect(loadSessions('kb-b')).toHaveLength(1)
  })

  it('activeId 也按 kbId 隔离', () => {
    saveActiveId('a', 'kb-a')
    expect(loadActiveId('kb-a')).toBe('a')
    expect(loadActiveId('kb-b')).toBeNull()
    expect(loadActiveId()).toBeNull()
  })
})

describe('upsertSession / loadSessions', () => {
  it('新建会话后可加载，按 updatedAt 倒序', () => {
    upsertSession(makeSession('a', 1000))
    upsertSession(makeSession('b', 2000))
    const list = loadSessions()
    expect(list.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('同 id 更新是替换而非新增', () => {
    upsertSession(makeSession('a', 1000))
    upsertSession({ ...makeSession('a', 3000), title: '更新后' })
    const list = loadSessions()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('更新后')
  })

  it(`容量上限 ${MAX_SESSIONS} 个，超出删最旧`, () => {
    for (let i = 0; i < MAX_SESSIONS + 5; i++) {
      upsertSession(makeSession(`s${i}`, 1000 + i))
    }
    const list = loadSessions()
    expect(list).toHaveLength(MAX_SESSIONS)
    // 最旧的 s0 应被淘汰，最新的保留
    expect(list.some((s) => s.id === 's0')).toBe(false)
    expect(list.some((s) => s.id === `s${MAX_SESSIONS + 4}`)).toBe(true)
  })
})

describe('loadSessions 容错', () => {
  it('损坏的 JSON 返回空数组', () => {
    localStorage.setItem('rag-chat-ui:default:sessions', '{oops')
    expect(loadSessions()).toEqual([])
  })
  it('非数组内容返回空数组', () => {
    localStorage.setItem('rag-chat-ui:default:sessions', '42')
    expect(loadSessions()).toEqual([])
  })
  it('过滤缺 id/messages 的脏数据', () => {
    localStorage.setItem(
      'rag-chat-ui:default:sessions',
      JSON.stringify([
        makeSession('ok', 1000),
        { id: 123, messages: [] },
        { id: 'no-messages' },
        null,
      ]),
    )
    expect(loadSessions().map((s) => s.id)).toEqual(['ok'])
  })
})

describe('removeSession / activeId', () => {
  it('removeSession 按 id 删除', () => {
    upsertSession(makeSession('a', 1000))
    upsertSession(makeSession('b', 2000))
    expect(removeSession('a').list.map((s) => s.id)).toEqual(['b'])
  })

  it('localStorage 写入抛错时 ok=false，内存列表仍返回', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('存储已满', 'QuotaExceededError')
    })
    try {
      const res = upsertSession(makeSession('a', 1000))
      expect(res.ok).toBe(false)
      expect(res.list.map((s) => s.id)).toEqual(['a'])
    } finally {
      spy.mockRestore()
    }
  })

  it('activeId 存取与清除', () => {
    expect(loadActiveId()).toBeNull()
    saveActiveId('a')
    expect(loadActiveId()).toBe('a')
    saveActiveId(null)
    expect(loadActiveId()).toBeNull()
  })
})

describe('makeTitle', () => {
  const user = (content: string): ChatMessage => ({ id: 'u', role: 'user', content })
  const asst = (content: string, error = false): ChatMessage => ({
    id: 'a',
    role: 'assistant',
    content,
    error,
  })

  it('qa 模式取首条用户消息前 20 字', () => {
    const long = '这是一个非常非常非常长的问题超过了二十个字限制'
    expect(makeTitle('qa', null, [user(long)])).toBe(long.slice(0, 20))
  })
  it('qa 模式无用户消息时为「新对话」', () => {
    expect(makeTitle('qa', null, [])).toBe('新对话')
  })
  it('interview 模式首条用户消息是真实作答时直接用它', () => {
    expect(makeTitle('interview', null, [user('我的作答内容')])).toBe('我的作答内容')
  })
  it('interview 模式首条用户消息是触发信号「开始」时退到首条 AI 内容', () => {
    const messages = [user('开始'), asst('第一题：什么是 RAG？'), user('我的作答内容')]
    // 实现只检查「第一条」用户消息是否为「开始」，不会向后找第二条用户消息
    expect(makeTitle('interview', null, messages)).toBe('第一题：什么是 RAG？')
  })
  it('interview 模式无有效用户消息时退到首条 AI 内容（空白折叠）', () => {
    expect(makeTitle('interview', null, [asst('第一题：什么是\nRAG？')])).toBe('第一题：什么是 RAG？')
  })
  it('interview 模式忽略错误消息，全部没有时用主题名', () => {
    expect(makeTitle('interview', '03-rag-system', [asst('出错了', true)])).toBe(
      '模拟面试 · 03-rag-system',
    )
    expect(makeTitle('interview', null, [])).toBe('模拟面试')
  })
})

describe('relativeTime', () => {
  it('各档位文案', () => {
    const now = Date.now()
    expect(relativeTime(now - 10_000)).toBe('刚刚')
    expect(relativeTime(now - 5 * 60_000)).toBe('5 分钟前')
    expect(relativeTime(now - 3 * 3_600_000)).toBe('3 小时前')
    expect(relativeTime(now - 2 * 86_400_000)).toBe('2 天前')
    // 超过 30 天退到日期字符串（只断言不是相对文案）
    expect(relativeTime(now - 40 * 86_400_000)).not.toContain('天前')
  })
})
