// linkifyCitations：正文 [n] 引用 → 来源卡片锚点链接 的纯函数行为
import { describe, expect, it } from 'vitest'
import { linkifyCitations } from './citations'

describe('linkifyCitations', () => {
  it('把有对应来源的 [n] 改写为 #source-{msgId}-{n-1} 链接', () => {
    const out = linkifyCitations('RAG 是检索增强生成 [1]，可缓解幻觉 [2]。', 'm1', 3)
    expect(out).toBe(
      'RAG 是检索增强生成 [\\[1\\]](#source-m1-0)，可缓解幻觉 [\\[2\\]](#source-m1-1)。',
    )
  })

  it('sourcesCount 为 0 时原样返回，不造死链', () => {
    expect(linkifyCitations('回答 [1]', 'm1', 0)).toBe('回答 [1]')
  })

  it('越界引用（0、超过来源数）与非数字方括号不改写', () => {
    expect(linkifyCitations('见 [0] 与 [3]', 'm1', 2)).toBe('见 [0] 与 [3]')
    expect(linkifyCitations('数组 a[0] 与 [abc]', 'm1', 2)).toBe('数组 a[0] 与 [abc]')
  })

  it('同一引用出现多次都被改写', () => {
    expect(linkifyCitations('[1] 与再次 [1]', 'm9', 1)).toBe(
      '[\\[1\\]](#source-m9-0) 与再次 [\\[1\\]](#source-m9-0)',
    )
  })
})

describe('linkifyCitations 代码区保护', () => {
  it('行内 code 与围栏代码块内的 [n] 不改写，散文 [n] 仍变链接', () => {
    const content = '散文引用 [1]。行内 `dp[1]` 是下标。\n\n```ts\nconst x = arr[2] // 注释里的 [3] 也不是引用\n```\n\n结尾再引 [2]。'
    const out = linkifyCitations(content, 'm1', 3)
    // 散文里的 [1]/[2] 变链接
    expect(out).toContain('[\\[1\\]](#source-m1-0)')
    expect(out).toContain('[\\[2\\]](#source-m1-1)')
    // 行内 code 原样
    expect(out).toContain('`dp[1]`')
    // 围栏块内原样（含注释里的 [3]）
    expect(out).toContain('arr[2]')
    expect(out).toContain('// 注释里的 [3] 也不是引用')
  })

  it('未闭合的围栏块到末尾都不改写', () => {
    const out = linkifyCitations('前文 [1]\n```\ncode[2]', 'm1', 2)
    expect(out).toContain('[\\[1\\]](#source-m1-0)')
    expect(out).toContain('code[2]')
  })
})
