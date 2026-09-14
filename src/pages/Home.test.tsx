// @vitest-environment jsdom
// Home 页请求生命周期：请求所有权 / 错误重试 / 纯失败会话不落盘 / history 截断
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Home from './Home'
import { fetchStats, streamChat } from '@/lib/api'
import { loadSessions } from '@/lib/sessions'
import { loadMistakes } from '@/lib/mistakes'
import { toast } from 'sonner'
import type { ChatMessage, Health, Stats } from '@/types'

vi.mock('@/lib/api', () => ({
  // 统计信息默认永不 resolve，避免产生额外渲染；需要主题列表的用例自行 mockResolvedValueOnce
  fetchStats: vi.fn(() => Promise.withResolvers<Stats>().promise),
  fetchHealth: vi.fn(() => Promise.withResolvers<Health>().promise),
  streamChat: vi.fn(),
}))

vi.mock('sonner', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
  return { toast: t }
})

// jsdom 未实现 scrollIntoView（ChatArea 自动滚动到底部会调用）
Element.prototype.scrollIntoView = vi.fn()

const mockStreamChat = vi.mocked(streamChat)
const mockFetchStats = vi.mocked(fetchStats)
const mockToast = vi.mocked(toast)
type Handlers = Parameters<typeof streamChat>[2]

function sendQuestion(text: string) {
  const textarea = screen.getByPlaceholderText(/输入你的问题|输入你的回答/)
  fireEvent.change(textarea, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  return textarea
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  mockStreamChat.mockReset()
})

afterEach(cleanup)

describe('Home 请求生命周期', () => {
  it('请求所有权：旧请求迟到完成不得污染新会话，其 finally 不复位新请求状态', async () => {
    const d1 = Promise.withResolvers<void>()
    const d2 = Promise.withResolvers<void>()
    let h1: Handlers | undefined
    let h2: Handlers | undefined
    mockStreamChat
      .mockImplementationOnce((_req, _signal, handlers) => {
        h1 = handlers
        return d1.promise // 第一条：挂起，模拟慢请求
      })
      .mockImplementationOnce((_req, _signal, handlers) => {
        h2 = handlers
        return d2.promise // 第二条：稍后手动完成
      })

    render(<Home />)
    const textarea = sendQuestion('问题一')
    await screen.findByText('问题一')
    expect(mockStreamChat).toHaveBeenCalledTimes(1)
    // 流式中：textarea 不再禁用（允许预输入），以「停止」按钮标识进行中状态
    expect(textarea).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument()

    // 用户点「新对话」：abort 旧请求、清空消息，随后立即发第二条
    fireEvent.click(screen.getByRole('button', { name: /新对话/ }))
    sendQuestion('问题二')
    await screen.findByText('问题二')
    expect(mockStreamChat).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument() // 第二条仍在流式中

    if (!h1 || !h2) throw new Error('streamChat handlers 未被捕获')
    const stale = h1
    const fresh = h2

    // 旧请求迟到：残留 token + AbortError 都不应碰到新会话
    await act(async () => {
      stale.onToken('旧请求污染')
      stale.onStatus('generating')
      d1.reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
      await d1.promise.catch(() => {})
    })
    expect(screen.queryByText(/旧请求污染/)).not.toBeInTheDocument()
    expect(screen.queryByText(/已手动停止/)).not.toBeInTheDocument()
    // 旧请求的 finally 不得把新请求的流式状态复位
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument()

    // 新请求正常完成
    await act(async () => {
      fresh.onToken('第二次回答')
      fresh.onDone()
      d2.resolve()
      await d2.promise
    })
    await screen.findByText('第二次回答')
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument()
  })

  it('后端错误可重试：移除错误占位并重发同一问题', async () => {
    mockStreamChat
      .mockImplementationOnce(async (_req, _signal, handlers) => {
        handlers.onError({ code: 'LLM_STREAM_FAILED', message: '模型连接中断', retryable: true })
      })
      .mockImplementationOnce(async (_req, _signal, handlers) => {
        handlers.onToken('重试后的回答')
        handlers.onDone()
      })

    render(<Home />)
    // 超过 20 字的问题：侧边栏会话标题只取前 20 字，不会与聊天气泡全文混淆
    const question = '这是一个会失败的问题需要重试验证一下长度才行'
    sendQuestion(question)

    const retryBtn = await screen.findByRole('button', { name: '重试' })
    expect(screen.getByText(/模型连接中断/)).toBeInTheDocument()

    fireEvent.click(retryBtn)
    await waitFor(() => expect(mockStreamChat).toHaveBeenCalledTimes(2))
    // 重发的是同一个问题
    expect(mockStreamChat.mock.calls[1][0].question).toBe(question)
    await screen.findByText('重试后的回答')
    // 错误占位已移除，且没有重复的用户气泡
    expect(screen.queryByText(/模型连接中断/)).not.toBeInTheDocument()
    expect(screen.getAllByText(question)).toHaveLength(1)
  })

  it('纯失败会话（全部消息为错误）不写入 localStorage', async () => {
    mockStreamChat.mockImplementationOnce(async (_req, _signal, handlers) => {
      handlers.onError({ code: 'RETRIEVE_FAILED', message: '检索失败', retryable: true })
    })

    render(<Home />)
    // 切到模拟面试模式（Radix Tabs 在 mouseDown 时激活）后从空状态直接开考：
    // hideUser，会话里只有 assistant 错误消息
    fireEvent.mouseDown(screen.getByRole('tab', { name: /模拟面试/ }))
    fireEvent.click(await screen.findByRole('button', { name: /综合模拟面试/ }))

    await screen.findByText(/检索失败/)
    // 流式收尾完成：停止按钮消失、发送按钮回归
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument(),
    )
    expect(loadSessions()).toEqual([])
  })

  it('重试绑定原问题：q1 失败、q2 成功后，点 q1 的重试必须重发 q1', async () => {
    mockStreamChat
      .mockImplementationOnce(async (_req, _signal, handlers) => {
        handlers.onError({ code: 'LLM_STREAM_FAILED', message: 'q1 模型失败', retryable: true })
      })
      .mockImplementationOnce(async (_req, _signal, handlers) => {
        handlers.onToken('q2 的回答')
        handlers.onDone()
      })
      .mockImplementationOnce(async (_req, _signal, handlers) => {
        handlers.onToken('q1 重试后的回答')
        handlers.onDone()
      })

    render(<Home />)
    sendQuestion('第一个问题会失败')
    await screen.findByText(/q1 模型失败/)

    sendQuestion('第二个问题成功')
    await screen.findByText('q2 的回答')

    // 只有 q1 的错误消息有重试按钮
    const retryBtns = screen.getAllByRole('button', { name: '重试' })
    expect(retryBtns).toHaveLength(1)
    fireEvent.click(retryBtns[0])

    await waitFor(() => expect(mockStreamChat).toHaveBeenCalledTimes(3))
    expect(mockStreamChat.mock.calls[2][0].question).toBe('第一个问题会失败')
    await screen.findByText('q1 重试后的回答')
  })

  it('恢复含 requestQuestion 的失败消息后，重试仍发送原问题（无需配对 user 消息）', async () => {
    const failedMsg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '后端错误：服务不可用',
      error: true,
      errorCode: 'LLM_STREAM_FAILED',
      retryable: true,
      requestQuestion: '刷新前的原始问题',
    }
    localStorage.setItem(
      'rag-qa:sessions',
      JSON.stringify([
        { id: 's1', title: 't', mode: 'qa', topic: null, messages: [failedMsg], updatedAt: 1 },
      ]),
    )
    localStorage.setItem('rag-qa:active-session', 's1')
    mockStreamChat.mockImplementationOnce(async (_req, _signal, handlers) => {
      handlers.onToken('恢复后重试的回答')
      handlers.onDone()
    })

    render(<Home />)
    fireEvent.click(await screen.findByRole('button', { name: '重试' }))
    await waitFor(() => expect(mockStreamChat).toHaveBeenCalledTimes(1))
    expect(mockStreamChat.mock.calls[0][0].question).toBe('刷新前的原始问题')
    await screen.findByText('恢复后重试的回答')
  })

  it('无 requestQuestion 且无配对用户消息的错误消息不显示重试按钮', async () => {
    localStorage.setItem(
      'rag-qa:sessions',
      JSON.stringify([
        {
          id: 's1',
          title: 't',
          mode: 'qa',
          topic: null,
          messages: [{ id: 'a1', role: 'assistant', content: '后端错误：挂了', error: true }],
          updatedAt: 1,
        },
      ]),
    )
    localStorage.setItem('rag-qa:active-session', 's1')

    render(<Home />)
    await screen.findByText('后端错误：挂了')
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
  })

  it('非 Abort 异常：已收到的部分内容保留，失败信息追加在后', async () => {
    const d = Promise.withResolvers<void>()
    let hh: Handlers | undefined
    mockStreamChat.mockImplementationOnce((_req, _signal, handlers) => {
      hh = handlers
      return d.promise
    })

    render(<Home />)
    sendQuestion('会异常的问题')
    await screen.findByText('会异常的问题')
    if (!hh) throw new Error('streamChat handlers 未被捕获')
    const h = hh

    await act(async () => {
      h.onToken('已生成的部分内容')
      d.reject(new Error('网络中断'))
      await d.promise.catch(() => {})
    })

    const bubble = await screen.findByText(/已生成的部分内容/)
    expect(bubble.textContent).toContain('请求失败：网络中断')
  })

  it('retryable:false 的错误消息不显示重试按钮', async () => {
    localStorage.setItem(
      'rag-qa:sessions',
      JSON.stringify([
        {
          id: 's1',
          title: 't',
          mode: 'qa',
          topic: null,
          messages: [
            { id: 'u1', role: 'user', content: '问题' },
            {
              id: 'a1',
              role: 'assistant',
              content: '后端错误：配额超限',
              error: true,
              errorCode: 'LLM_QUOTA_EXCEEDED',
              retryable: false,
              requestQuestion: '问题',
            },
          ],
          updatedAt: 1,
        },
      ]),
    )
    localStorage.setItem('rag-qa:active-session', 's1')

    render(<Home />)
    await screen.findByText('后端错误：配额超限')
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
  })

  it('删除会话存储失败：弹错误提示，会话不移出侧栏', () => {
    localStorage.setItem(
      'rag-qa:sessions',
      JSON.stringify([
        {
          id: 's1',
          title: '历史会话一',
          mode: 'qa',
          topic: null,
          messages: [{ id: 'u1', role: 'user', content: '旧问题' }],
          updatedAt: 1,
        },
      ]),
    )
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('存储已满', 'QuotaExceededError')
    })
    try {
      render(<Home />)
      fireEvent.click(screen.getByRole('button', { name: '删除会话' }))
      expect(mockToast.error).toHaveBeenCalledWith('删除失败：浏览器存储不可用')
      // 侧栏与存储都还在
      expect(screen.getByText('历史会话一')).toBeInTheDocument()
      expect(loadSessions()).toHaveLength(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('请求完成后 rag-qa:sessions 只写入一次（无双重落盘）', async () => {
    const setSpy = vi.spyOn(Storage.prototype, 'setItem')
    try {
      mockStreamChat.mockImplementationOnce(async (_req, _signal, handlers) => {
        handlers.onToken('完整回答')
        handlers.onDone()
      })

      render(<Home />)
      sendQuestion('落盘计数问题')
      await screen.findByText('完整回答')
      await waitFor(() => {
        const writes = setSpy.mock.calls.filter((c) => c[0] === 'rag-qa:sessions')
        expect(writes).toHaveLength(1)
      })
    } finally {
      setSpy.mockRestore()
    }
  })

  it('恢复会话后点击 topic：解除浏览恢复标记，新配置落盘', async () => {
    mockFetchStats.mockResolvedValueOnce({
      chunks: 3,
      llm_model: 'm',
      embed_model: 'e',
      topics: [{ name: '03-rag-system', count: 2 }],
    })
    localStorage.setItem(
      'rag-qa:sessions',
      JSON.stringify([
        {
          id: 's1',
          title: '被恢复的会话',
          mode: 'qa',
          topic: null,
          messages: [
            { id: 'u1', role: 'user', content: '旧问题' },
            { id: 'a1', role: 'assistant', content: '旧回答' },
          ],
          updatedAt: 1,
        },
      ]),
    )
    localStorage.setItem('rag-qa:active-session', 's1')

    render(<Home />)
    await screen.findByText('旧回答')
    // 仅浏览恢复不落盘：updatedAt 保持原值
    expect(JSON.parse(localStorage.getItem('rag-qa:sessions') ?? '[]')[0].updatedAt).toBe(1)

    fireEvent.click(await screen.findByRole('button', { name: /03-rag-system/ }))
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('rag-qa:sessions') ?? '[]')
      expect(saved[0].topic).toBe('03-rag-system')
      expect(saved[0].updatedAt).toBeGreaterThan(1)
    })
  })

  it('history 截断：只携带最近 20 条（约 10 轮）', async () => {
    const historyMsgs: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `内容 ${i}`,
    }))
    localStorage.setItem(
      'rag-qa:sessions',
      JSON.stringify([
        {
          id: 's1',
          title: '历史会话',
          mode: 'qa',
          topic: null,
          messages: historyMsgs,
          updatedAt: Date.now(),
        },
      ]),
    )
    localStorage.setItem('rag-qa:active-session', 's1')
    mockStreamChat.mockImplementationOnce(async () => {})

    render(<Home />)
    await screen.findByText('内容 29') // 等待会话恢复
    sendQuestion('新问题')

    await waitFor(() => expect(mockStreamChat).toHaveBeenCalledTimes(1))
    const req = mockStreamChat.mock.calls[0][0]
    expect(req.history.length).toBeLessThanOrEqual(20)
    expect(req.history[0]).toEqual({ role: 'user', content: '内容 10' })
  })
})

describe('Home 错题手动收藏：题答配对', () => {
  it('QA 模式：question 是用户问题原文，answer 是 AI 回答', async () => {
    const answer = 'RAG 是检索增强生成，它解决了大模型知识过时的问题。'
    mockStreamChat.mockImplementationOnce(async (_req, _signal, handlers) => {
      handlers.onToken(answer)
      handlers.onDone()
    })

    render(<Home />)
    sendQuestion('什么是 RAG？它解决了什么问题？')
    await screen.findByText(/RAG 是检索增强生成/)
    // 等待流式收尾（hover 操作条在 streaming=false 后才出现）
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: '加入错题本' }))

    const saved = loadMistakes()
    expect(saved).toHaveLength(1)
    expect(saved[0].question).toBe('什么是 RAG？它解决了什么问题？')
    expect(saved[0].answer).toBe(answer)
    expect(mockToast.success).toHaveBeenCalledWith('已加入错题本')
  })

  it('interview 模式：收藏点评消息，question 是被回答的题目、answer 是正确答案小节', async () => {
    const question1 = '什么是 RAG？请简述其核心流程。'
    const review =
      '你的回答不太完整。\n\n### 正确答案\nRAG 是检索增强生成。\n\n### 解析\n先检索再生成。\n\n下一题：什么是向量数据库？'
    mockStreamChat
      .mockImplementationOnce(async (_req, _signal, handlers) => {
        handlers.onToken(question1)
        handlers.onDone()
      })
      .mockImplementationOnce(async (_req, _signal, handlers) => {
        handlers.onToken(review)
        handlers.onDone()
      })

    render(<Home />)
    // 切到模拟面试模式（Radix Tabs 在 mouseDown 时激活）后从空状态直接开考
    fireEvent.mouseDown(screen.getByRole('tab', { name: /模拟面试/ }))
    fireEvent.click(await screen.findByRole('button', { name: /综合模拟面试/ }))
    await screen.findByText(/什么是 RAG？请简述其核心流程/)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument(),
    )

    sendQuestion('我不知道')
    await screen.findByText(/你的回答不太完整/)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument(),
    )

    // 两条 assistant 消息（题目、点评）都有收藏按钮；收藏第二条（点评）
    const saveBtns = screen.getAllByRole('button', { name: '加入错题本' })
    expect(saveBtns).toHaveLength(2)
    fireEvent.click(saveBtns[1])

    // 该回复含「正确答案」小节，流式结束时已自动收录；手动收藏必须按同一题目去重刷新，
    // 而不是把「下一题」当成新错题再存一条
    const saved = loadMistakes()
    expect(saved).toHaveLength(1)
    expect(saved[0].question).toBe(question1)
    expect(saved[0].answer).toBe('### 正确答案\nRAG 是检索增强生成。\n\n### 解析\n先检索再生成。')
    expect(saved[0].reviewCount).toBe(1) // 自动收录 + 手动刷新
  })
})

describe('Home 流式阶段提示', () => {
  it('首 token 到达前按 sendState 显示检索/生成/降级提示，token 到达后消失', async () => {
    const d = Promise.withResolvers<void>()
    let hh: Handlers | undefined
    mockStreamChat.mockImplementationOnce((_req, _signal, handlers) => {
      hh = handlers
      return d.promise
    })
    // 滚动行为断言：spy 替换 jsdom 未实现的 scrollIntoView
    const proto = Element.prototype as unknown as { scrollIntoView?: unknown }
    const prevScroll = proto.scrollIntoView
    const scrollSpy = vi.fn<(options?: ScrollIntoViewOptions) => void>()
    proto.scrollIntoView = scrollSpy

    try {
      render(<Home />)
      sendQuestion('阶段提示问题')
      // 首个 status 事件前默认检索阶段
      expect(await screen.findByText('正在检索知识库…')).toBeInTheDocument()
      if (!hh) throw new Error('streamChat handlers 未被捕获')
      const h = hh

      await act(async () => {
        h.onStatus('generating')
      })
      expect(screen.queryByText('正在检索知识库…')).not.toBeInTheDocument()
      expect(screen.getByText('正在生成回答…')).toBeInTheDocument()

      await act(async () => {
        h.onStatus('fallback')
      })
      expect(screen.getByText('本地模型不可用，使用知识库摘录回答…')).toBeInTheDocument()

      // 首个 token 到达：阶段提示让位给正文
      await act(async () => {
        h.onToken('正式回答')
        h.onDone()
        d.resolve()
        await d.promise
      })
      await screen.findByText(/正式回答/)
      expect(screen.queryByText('本地模型不可用，使用知识库摘录回答…')).not.toBeInTheDocument()

      // 流式期间每 token 用 instant；流式结束后的最后一次滚动用 smooth
      const behaviors = scrollSpy.mock.calls.map((c) => c[0]?.behavior)
      expect(behaviors).toContain('auto')
      expect(behaviors.at(-1)).toBe('smooth')
    } finally {
      proto.scrollIntoView = prevScroll
    }
  })
})

describe('Home 响应式布局', () => {
  it('内联侧栏 <md 隐藏（断点 class），顶栏提供「打开菜单」按钮', () => {
    render(<Home />)
    const aside = document.querySelector('aside')
    expect(aside).not.toBeNull()
    expect(aside).toHaveClass('hidden', 'md:flex')
    expect(screen.getByRole('button', { name: '打开菜单' })).toBeInTheDocument()
  })

  it('打开移动抽屉：渲染 Sheet 导航；在抽屉里点「新对话」后自动关闭', async () => {
    render(<Home />)
    // 抽屉关闭时不渲染 Sheet 内容
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '打开菜单' }))
    // Radix Dialog 打开后背景被 aria-hidden，此时唯一可访问的「新对话」即抽屉内那份
    const drawerNewChat = await screen.findByRole('button', { name: /新对话/ })
    const sheet = document.querySelector('[data-slot="sheet-content"]')
    expect(sheet).not.toBeNull()
    expect(sheet?.contains(drawerNewChat)).toBe(true)

    fireEvent.click(drawerNewChat)
    await waitFor(() =>
      expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull(),
    )
  })
})

describe('Home 会话恢复滚动', () => {
  it('刷新恢复会话后首次定位用 instant（auto）滚动', async () => {
    localStorage.setItem(
      'rag-qa:sessions',
      JSON.stringify([
        {
          id: 's1',
          title: '被恢复的长会话',
          mode: 'qa',
          topic: null,
          messages: [
            { id: 'u1', role: 'user', content: '旧问题' },
            { id: 'a1', role: 'assistant', content: '旧回答' },
          ],
          updatedAt: 1,
        },
      ]),
    )
    localStorage.setItem('rag-qa:active-session', 's1')
    const proto = Element.prototype as unknown as { scrollIntoView?: unknown }
    const prevScroll = proto.scrollIntoView
    const scrollSpy = vi.fn()
    proto.scrollIntoView = scrollSpy
    try {
      render(<Home />)
      await screen.findByText('旧回答')
      expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
    } finally {
      proto.scrollIntoView = prevScroll
    }
  })
})
