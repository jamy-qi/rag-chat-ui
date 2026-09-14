// @vitest-environment jsdom
// MessageItem 手动收藏错题：题答配对、存储失败不得谎报成功
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { MessageItem } from './MessageItem'
import { loadMistakes } from '@/lib/mistakes'
import type { ChatMessage } from '@/types'

vi.mock('sonner', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
  return { toast: t }
})
const mockToast = vi.mocked(toast)

const asstMsg: ChatMessage = {
  id: 'a1',
  role: 'assistant',
  content: '什么是 RAG？请说明它解决了什么问题。',
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('MessageItem 收藏错题', () => {
  it('正常收藏弹成功 toast', () => {
    render(<MessageItem message={asstMsg} streaming={false} topic={null} pairedQuestion={null} />)
    fireEvent.click(screen.getByRole('button', { name: '加入错题本' }))
    expect(mockToast.success).toHaveBeenCalledWith('已加入错题本')
  })

  it('存储写入失败时弹错误 toast，不谎报成功', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('存储已满', 'QuotaExceededError')
    })
    try {
      render(<MessageItem message={asstMsg} streaming={false} topic={null} pairedQuestion={null} />)
      fireEvent.click(screen.getByRole('button', { name: '加入错题本' }))
      expect(mockToast.error).toHaveBeenCalledWith('保存失败：浏览器存储不可用')
      expect(mockToast.success).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('优先使用配对题目，而非从内容提取的「下一题」', () => {
    const reviewMsg: ChatMessage = {
      id: 'a2',
      role: 'assistant',
      content: '点评\n\n### 正确答案\n答案内容\n\n下一题：下一个题目是什么',
    }
    render(
      <MessageItem
        message={reviewMsg}
        streaming={false}
        topic="03-rag-system"
        pairedQuestion="被回答的原题目"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '加入错题本' }))
    const saved = loadMistakes()[0]
    expect(saved.question).toBe('被回答的原题目')
    expect(saved.answer).toBe('### 正确答案\n答案内容')
    expect(saved.topic).toBe('03-rag-system')
  })

  it('消息无答案小节时 answer 回退为整段内容（QA 回答收藏）', () => {
    render(
      <MessageItem
        message={asstMsg}
        streaming={false}
        topic={null}
        pairedQuestion="用户的原始问题"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '加入错题本' }))
    const saved = loadMistakes()[0]
    expect(saved.question).toBe('用户的原始问题')
    expect(saved.answer).toBe('什么是 RAG？请说明它解决了什么问题。')
  })

  it('配对题目过短（<4 字）时弹错误且不收录', () => {
    render(<MessageItem message={asstMsg} streaming={false} topic={null} pairedQuestion="好的" />)
    fireEvent.click(screen.getByRole('button', { name: '加入错题本' }))
    expect(mockToast.error).toHaveBeenCalledWith('无法识别对应题目，未收录')
    expect(loadMistakes()).toHaveLength(0)
  })
})

describe('MessageItem 引用锚点与无来源提示', () => {
  const msgWithSources: ChatMessage = {
    id: 'a1',
    role: 'assistant',
    content: 'RAG 是检索增强生成 [1]，可缓解幻觉 [2]。越界引用 [9] 不变。',
    sources: [
      { title: 'RAG 介绍', text: 't1', source: 'docs/rag.md', score: 0.82 },
      { title: 'LLM 局限', text: 't2', source: 'docs/llm.md', score: 0.71 },
    ],
  }

  // scrollIntoView jsdom 未实现：用 spy 占位并在用后恢复，避免污染其他用例
  const proto = Element.prototype as unknown as { scrollIntoView?: unknown }
  const originalScrollIntoView = proto.scrollIntoView
  let scrollSpy: Mock
  beforeEach(() => {
    scrollSpy = vi.fn()
    proto.scrollIntoView = scrollSpy
  })
  afterEach(() => {
    proto.scrollIntoView = originalScrollIntoView
  })

  it('正文 [n] 渲染为指向 #source-{msgId}-{n-1} 的链接，来源卡片带对应锚点 id', () => {
    const { container } = render(
      <MessageItem message={msgWithSources} streaming={false} topic={null} pairedQuestion={null} />,
    )
    expect(screen.getByRole('link', { name: '[1]' })).toHaveAttribute('href', '#source-a1-0')
    expect(screen.getByRole('link', { name: '[2]' })).toHaveAttribute('href', '#source-a1-1')
    // 越界 [9] 不生成链接
    expect(screen.queryByRole('link', { name: '[9]' })).not.toBeInTheDocument()
    // 来源卡片容器带锚点 id
    expect(container.querySelector('#source-a1-0')).not.toBeNull()
    expect(container.querySelector('#source-a1-1')).not.toBeNull()
  })

  it('点击引用链接平滑滚动到目标卡片并加高亮 class', () => {
    const { container } = render(
      <MessageItem message={msgWithSources} streaming={false} topic={null} pairedQuestion={null} />,
    )
    fireEvent.click(screen.getByRole('link', { name: '[1]' }))
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
    expect(container.querySelector('#source-a1-0')).toHaveClass('citation-flash')
  })

  it('prefers-reduced-motion 时引用跳转用 instant（auto）', () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    try {
      render(
        <MessageItem message={msgWithSources} streaming={false} topic={null} pairedQuestion={null} />,
      )
      fireEvent.click(screen.getByRole('link', { name: '[1]' }))
      expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it('回答中的 http(s) 外链新窗口打开且带 noopener', () => {
    const msg: ChatMessage = {
      id: 'a9',
      role: 'assistant',
      content: '参考 [原文](https://example.com/doc) 与 [1]。',
      sources: [{ title: 'RAG 介绍', text: 't1', source: 'docs/rag.md', score: 0.82 }],
    }
    render(<MessageItem message={msg} streaming={false} topic={null} pairedQuestion={null} />)
    const external = screen.getByRole('link', { name: '原文' })
    expect(external).toHaveAttribute('target', '_blank')
    expect(external).toHaveAttribute('rel', expect.stringContaining('noopener'))
    // 引用链接不加 target
    expect(screen.getByRole('link', { name: '[1]' })).not.toHaveAttribute('target')
  })

  it('有来源时不显示「未检索到资料」提示', () => {
    render(
      <MessageItem message={msgWithSources} streaming={false} topic={null} pairedQuestion={null} />,
    )
    expect(screen.queryByText('本次回答未检索到可用知识库资料')).not.toBeInTheDocument()
  })

  it('无来源且回答完成时显示中性提示；流式中不显示', () => {
    const noSources: ChatMessage = { id: 'a2', role: 'assistant', content: '直接回答的内容' }
    const { rerender } = render(
      <MessageItem message={noSources} streaming={true} topic={null} pairedQuestion={null} />,
    )
    expect(screen.queryByText('本次回答未检索到可用知识库资料')).not.toBeInTheDocument()
    rerender(
      <MessageItem message={noSources} streaming={false} topic={null} pairedQuestion={null} />,
    )
    expect(screen.getByText('本次回答未检索到可用知识库资料')).toBeInTheDocument()
  })

  it('流式且内容为空时显示阶段提示', () => {
    const empty: ChatMessage = { id: 'a3', role: 'assistant', content: '' }
    render(
      <MessageItem
        message={empty}
        streaming={true}
        topic={null}
        pairedQuestion={null}
        stageHint="正在检索知识库…"
      />,
    )
    expect(screen.getByText('正在检索知识库…')).toBeInTheDocument()
  })
})
