// @vitest-environment jsdom
// 高价值冒烟测试：错题本面板空状态 / 列表渲染 / 展开答案 / 再考我一次回调
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { MistakesPanel } from './MistakesPanel'
import type { Mistake } from '@/types'

vi.mock('sonner', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
  return { toast: t }
})
const mockToast = vi.mocked(toast)

const noop = () => {}

const sample: Mistake = {
  id: 'm1',
  question: '什么是 RAG？',
  answer: '',
  topic: null,
  createdAt: Date.now(),
  reviewCount: 2,
}

// vitest globals 未开启，RTL 的自动 cleanup 不生效，需手动注册
afterEach(cleanup)

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('MistakesPanel', () => {
  it('空列表显示友好空状态', () => {
    render(<MistakesPanel open onOpenChange={noop} mistakes={[]} onRetry={noop} />)
    expect(screen.getByText('错题本还是空的')).toBeInTheDocument()
    expect(screen.getByText(/模拟面试中答错或表示不会的题会自动收录/)).toBeInTheDocument()
  })

  it('列表项显示题目 / 综合标签（topic=null）/ 复习次数，答案默认折叠', () => {
    render(<MistakesPanel open onOpenChange={noop} mistakes={[sample]} onRetry={noop} />)
    expect(screen.getByText('什么是 RAG？')).toBeInTheDocument()
    // 「综合」同时出现在主题徽标和筛选下拉选项里
    expect(screen.getAllByText('综合').length).toBeGreaterThan(0)
    expect(screen.getByText('复习 2 次')).toBeInTheDocument()
    expect(screen.queryByText('（未记录答案）')).not.toBeInTheDocument()
  })

  it('点击「显示答案」展开，无答案时显示占位文案', () => {
    render(<MistakesPanel open onOpenChange={noop} mistakes={[sample]} onRetry={noop} />)
    fireEvent.click(screen.getByText('显示答案'))
    expect(screen.getByText('（未记录答案）')).toBeInTheDocument()
    // 再点一次收起
    fireEvent.click(screen.getByText('收起答案'))
    expect(screen.queryByText('（未记录答案）')).not.toBeInTheDocument()
  })

  it('「再考我一次」把该错题交给 onRetry 回调', () => {
    const onRetry = vi.fn()
    render(<MistakesPanel open onOpenChange={noop} mistakes={[sample]} onRetry={onRetry} />)
    fireEvent.click(screen.getByText('再考我一次'))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(sample)
  })

  it('主题筛选下拉只列出实际出现过的主题，筛选「综合」只显示无主题错题', () => {
    const list: Mistake[] = [
      sample,
      { ...sample, id: 'm2', question: '什么是 Temperature？', topic: '03-rag-system' },
    ]
    render(<MistakesPanel open onOpenChange={noop} mistakes={list} onRetry={noop} />)
    const select = screen.getByLabelText('按主题筛选')
    fireEvent.change(select, { target: { value: 'none' } })
    expect(screen.getByText('什么是 RAG？')).toBeInTheDocument()
    expect(screen.queryByText('什么是 Temperature？')).not.toBeInTheDocument()
    fireEvent.change(select, { target: { value: '03-rag-system' } })
    expect(screen.queryByText('什么是 RAG？')).not.toBeInTheDocument()
    expect(screen.getByText('什么是 Temperature？')).toBeInTheDocument()
  })

  it('「已掌握」移出错题本时存储失败：弹错误 toast，不谎报成功', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('存储已满', 'QuotaExceededError')
    })
    try {
      render(<MistakesPanel open onOpenChange={noop} mistakes={[sample]} onRetry={noop} />)
      fireEvent.click(screen.getByRole('button', { name: '已掌握' }))
      expect(mockToast.error).toHaveBeenCalledWith('删除失败：浏览器存储不可用')
      expect(mockToast.success).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('「还不熟」标记时存储失败：弹错误 toast，不谎报成功', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('存储已满', 'QuotaExceededError')
    })
    try {
      render(<MistakesPanel open onOpenChange={noop} mistakes={[sample]} onRetry={noop} />)
      fireEvent.click(screen.getByRole('button', { name: '还不熟' }))
      expect(mockToast.error).toHaveBeenCalledWith('保存失败：浏览器存储不可用')
      expect(mockToast).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
