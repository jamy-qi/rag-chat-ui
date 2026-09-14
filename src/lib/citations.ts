import { prefersReducedMotion } from './utils'

/**
 * 来源卡片的锚点 id。messageId 理论上来自 crypto.randomUUID（charset 安全），
 * 但会话可从 localStorage 恢复（可能被手写/篡改），encode 防御异常字符导致 href 与 id 不匹配。
 */
export function sourceAnchorId(messageId: string, index: number): string {
  return `source-${encodeURIComponent(messageId)}-${index}`
}

/** 只处理有对应来源项的 [n]：sourcesCount 为 0 或 n 越界时保留原文，避免造出死链 */
function linkifySegment(segment: string, messageId: string, sourcesCount: number): string {
  return segment.replace(/\[(\d+)\]/g, (raw, num: string) => {
    const n = Number(num)
    if (!Number.isInteger(n) || n < 1 || n > sourcesCount) return raw
    // 链接文本保留 [n] 形态（markdown 链接文本内的方括号需转义）
    return `[\\[${num}\\]](#${sourceAnchorId(messageId, n - 1)})`
  })
}

/**
 * 把回答正文中的 [n] 引用标记改写成指向来源卡片锚点的 markdown 链接。
 * 代码区（``` 围栏块与 `...` 行内 code）不做改写：dp[1] / arr[2] 这类下标访问不是引用。
 * 已知边界：四反引号围栏等罕见写法未覆盖（本应用回答均为模型生成的常规 markdown）。
 */
export function linkifyCitations(content: string, messageId: string, sourcesCount: number): string {
  if (sourcesCount <= 0) return content
  let out = ''
  let last = 0
  // 先切出围栏代码块（含未闭合的尾巴），块内原样保留
  for (const m of content.matchAll(/```[\s\S]*?(?:```|$)/g)) {
    out += linkifyOutsideInlineCode(content.slice(last, m.index), messageId, sourcesCount)
    out += m[0]
    last = m.index + m[0].length
  }
  out += linkifyOutsideInlineCode(content.slice(last), messageId, sourcesCount)
  return out
}

/** 在非围栏段内再切出行内 code（`...`，不跨行），其余文本做 [n] 链接化 */
function linkifyOutsideInlineCode(segment: string, messageId: string, sourcesCount: number): string {
  let out = ''
  let last = 0
  for (const m of segment.matchAll(/`[^`\n]*`/g)) {
    out += linkifySegment(segment.slice(last, m.index), messageId, sourcesCount)
    out += m[0]
    last = m.index + m[0].length
  }
  out += linkifySegment(segment.slice(last), messageId, sourcesCount)
  return out
}

/** 平滑滚动到引用锚点并短暂高亮；prefers-reduced-motion 时禁用平滑滚动 */
export function scrollToCitationAnchor(anchorId: string): void {
  const target = document.getElementById(anchorId)
  if (!target) return
  target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
  target.classList.add('citation-flash')
  window.setTimeout(() => target.classList.remove('citation-flash'), 1200)
}
