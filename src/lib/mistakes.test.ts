// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_MISTAKES,
  MISTAKES_CHANGED,
  addMistake,
  extractAnswer,
  extractQuestion,
  filterMistakes,
  hasAnswerSection,
  loadMistakes,
  markReview,
  mistakeTopics,
  removeMistake,
  sortMistakes,
} from './mistakes'

beforeEach(() => {
  localStorage.clear()
})

// ---------- 提取逻辑：历史 bug 高发区 ----------

describe('hasAnswerSection', () => {
  it('标准 ### 标题', () => {
    expect(hasAnswerSection('点评\n\n### 正确答案\n内容')).toBe(true)
  })
  it('二级标题 / 加粗 / 半角冒号 / 无标题纯文本 都能识别', () => {
    expect(hasAnswerSection('## 正确答案\n内容')).toBe(true)
    expect(hasAnswerSection('**正确答案**\n内容')).toBe(true)
    expect(hasAnswerSection('### 正确答案: 内容')).toBe(true)
    expect(hasAnswerSection('正确答案是：内容')).toBe(true)
  })
  it('没有正确答案小节时返回 false', () => {
    expect(hasAnswerSection('下一题：什么是 RAG？')).toBe(false)
    expect(hasAnswerSection('')).toBe(false)
  })
  it('「正确答案」必须出现在行首（允许 #/*/空格前缀），行中提及不算', () => {
    expect(hasAnswerSection('你的回答里提到的正确答案并不完整')).toBe(false)
  })
})

describe('extractAnswer', () => {
  it('标准格式：取「### 正确答案」到「下一题：」之间的内容', () => {
    const content =
      '你的回答不太完整。\n\n### 正确答案\nRAG 是检索增强生成。\n\n### 解析\n先检索再生成。\n\n下一题：什么是向量数据库？'
    expect(extractAnswer(content)).toBe(
      '### 正确答案\nRAG 是检索增强生成。\n\n### 解析\n先检索再生成。',
    )
  })
  it('没有「下一题：」时取到文末', () => {
    expect(extractAnswer('### 正确答案\n只有答案，没有下一题。')).toBe(
      '### 正确答案\n只有答案，没有下一题。',
    )
  })
  it('加粗标题 + 全角冒号', () => {
    expect(extractAnswer('**正确答案：**\n加粗答案内容')).toBe('**正确答案：**\n加粗答案内容')
  })
  it('半角冒号', () => {
    expect(extractAnswer('### 正确答案:\n半角冒号答案')).toBe('### 正确答案:\n半角冒号答案')
  })
  it('二级标题', () => {
    expect(extractAnswer('## 正确答案\n二级标题答案')).toBe('## 正确答案\n二级标题答案')
  })
  it('标题行内带内容时保留整行', () => {
    expect(extractAnswer('### 正确答案：RAG 是检索增强生成')).toBe(
      '### 正确答案：RAG 是检索增强生成',
    )
  })
  it('纯文本「正确答案是：」', () => {
    expect(extractAnswer('正确答案是：先检索再生成')).toBe('正确答案是：先检索再生成')
  })
  it('空标题堆叠清理：丢弃后面紧跟标题的空标题行', () => {
    expect(extractAnswer('### 正确答案\n### 解析\n真正的内容')).toBe('### 解析\n真正的内容')
  })
  it('去掉首尾的分隔线 ---', () => {
    expect(extractAnswer('### 正确答案\n内容\n\n---')).toBe('### 正确答案\n内容')
  })
  it('没有正确答案小节返回空字符串', () => {
    expect(extractAnswer('下一题：什么是 RAG？')).toBe('')
  })
})

describe('extractQuestion', () => {
  it('有「下一题：」时取其后的题目', () => {
    expect(extractQuestion('点评内容\n\n下一题：什么是 RAG？')).toBe('什么是 RAG？')
  })
  it('多个「下一题：」取最后一个有效的', () => {
    expect(extractQuestion('下一题：第一题是什么\n\n下一题：第二题是什么')).toBe('第二题是什么')
  })
  it('最后一个「下一题：」是空尾巴时跳过，取前一个有效题目', () => {
    expect(extractQuestion('下一题：有效题目内容\n\n下一题：')).toBe('有效题目内容')
  })
  it('尾部题目不足 4 字视为无效，跳过', () => {
    expect(extractQuestion('下一题：有效题目内容\n\n下一题：好的')).toBe('有效题目内容')
  })
  it('所有「下一题：」都没有实质题目时返回空串（调用方放弃记录）', () => {
    expect(extractQuestion('点评内容\n\n下一题：')).toBe('')
  })
  it('没有「下一题：」时取整条消息（面试首问场景）', () => {
    expect(extractQuestion('请解释什么是 Transformer 架构？')).toBe('请解释什么是 Transformer 架构？')
  })
  it('整条提取时去掉开头的引用/装饰符号', () => {
    expect(extractQuestion('> 请解释什么是 Transformer？')).toBe('请解释什么是 Transformer？')
  })
  it('支持加粗与标题形式的「下一题」', () => {
    expect(extractQuestion('点评\n\n**下一题：** 什么是向量数据库？')).toBe('什么是向量数据库？')
  })
})

// ---------- localStorage 数据层 ----------

describe('addMistake', () => {
  it('新题收录：isNew=true，reviewCount=0', () => {
    const { list, mistake, isNew } = addMistake({
      question: '什么是 RAG？',
      answer: '### 正确答案\n检索增强生成',
      topic: '03-rag-system',
    })
    expect(isNew).toBe(true)
    expect(list).toHaveLength(1)
    expect(mistake.reviewCount).toBe(0)
    expect(mistake.topic).toBe('03-rag-system')
    expect(loadMistakes()).toHaveLength(1)
  })

  it('重复答错去重：不新增，刷新 createdAt 且 reviewCount +1', () => {
    const first = addMistake({ question: '什么是 RAG？', answer: '旧答案', topic: null })
    const second = addMistake({ question: '什么是 RAG？', answer: '新答案', topic: null })
    expect(second.isNew).toBe(false)
    expect(second.list).toHaveLength(1)
    expect(second.mistake.reviewCount).toBe(1)
    expect(second.mistake.createdAt).toBeGreaterThanOrEqual(first.mistake.createdAt)
    expect(second.mistake.answer).toBe('新答案')
  })

  it('去重按空白归一化后的 question 匹配', () => {
    addMistake({ question: '什么是   RAG？', answer: '', topic: null })
    const { isNew, list } = addMistake({ question: '什么是 RAG？', answer: '', topic: null })
    expect(isNew).toBe(false)
    expect(list).toHaveLength(1)
  })

  it('重复收藏时新 answer 为空则保留旧 answer', () => {
    addMistake({ question: 'Q', answer: '有答案', topic: null })
    const { mistake } = addMistake({ question: 'Q', answer: '', topic: null })
    expect(mistake.answer).toBe('有答案')
  })

  it('重复收藏时 topic 以新值为准：可改回 null（综合）', () => {
    addMistake({ question: '什么是 RAG？', answer: '旧答案', topic: '03-rag-system' })
    const { mistake, list } = addMistake({ question: '什么是 RAG？', answer: '新答案', topic: null })
    expect(mistake.topic).toBeNull()
    expect(list[0].topic).toBeNull()
    expect(loadMistakes()[0].topic).toBeNull()
  })

  it('重复收藏时 topic 以新值为准：综合也可改为主题', () => {
    addMistake({ question: '什么是 RAG？', answer: '', topic: null })
    const { mistake } = addMistake({ question: '什么是 RAG？', answer: '', topic: '03-rag-system' })
    expect(mistake.topic).toBe('03-rag-system')
  })

  it(`容量上限 ${MAX_MISTAKES} 条，超出删最旧`, () => {
    for (let i = 0; i < MAX_MISTAKES + 5; i++) {
      addMistake({ question: `题目 ${i}`, answer: '', topic: null })
    }
    const list = loadMistakes()
    expect(list).toHaveLength(MAX_MISTAKES)
  })

  it('收录时派发 MISTAKES_CHANGED 事件', () => {
    let fired = 0
    window.addEventListener(MISTAKES_CHANGED, () => fired++)
    addMistake({ question: 'Q', answer: '', topic: null })
    expect(fired).toBe(1)
  })

  it('不同 kbId 的错题互不可见', () => {
    addMistake({ question: 'Q1', answer: '', topic: null }, 'kb-a')
    addMistake({ question: 'Q2', answer: '', topic: null }, 'kb-b')
    expect(loadMistakes('kb-a').map((m) => m.question)).toEqual(['Q1'])
    expect(loadMistakes('kb-b').map((m) => m.question)).toEqual(['Q2'])
    // 去重也限定在各自命名空间内
    expect(addMistake({ question: 'Q1', answer: '', topic: null }, 'kb-b').isNew).toBe(true)
    // 未指定 kbId 时落到 default 命名空间
    expect(loadMistakes()).toEqual([])
  })
})

describe('removeMistake / markReview', () => {
  it('removeMistake 按 id 删除', () => {
    const { mistake } = addMistake({ question: 'Q', answer: '', topic: null })
    expect(removeMistake(mistake.id).list).toHaveLength(0)
    expect(loadMistakes()).toHaveLength(0)
  })

  it('markReview：reviewCount +1 且更新 lastReviewAt', () => {
    const { mistake } = addMistake({ question: 'Q', answer: '', topic: null })
    const { list } = markReview(mistake.id)
    expect(list[0].reviewCount).toBe(1)
    expect(list[0].lastReviewAt).toBeTypeOf('number')
  })

  it('localStorage 写入抛错时 ok=false，内存列表仍返回', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('存储已满', 'QuotaExceededError')
    })
    try {
      const res = addMistake({ question: 'Q', answer: '', topic: null })
      expect(res.ok).toBe(false)
      expect(res.list).toHaveLength(1)
      expect(removeMistake(res.mistake.id).ok).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('loadMistakes 容错', () => {
  it('损坏的 JSON 返回空数组', () => {
    localStorage.setItem('rag-chat-ui:default:mistakes', '{oops')
    expect(loadMistakes()).toEqual([])
  })
  it('非数组内容返回空数组', () => {
    localStorage.setItem('rag-chat-ui:default:mistakes', '{"a":1}')
    expect(loadMistakes()).toEqual([])
  })
  it('过滤缺字段的脏数据', () => {
    localStorage.setItem(
      'rag-chat-ui:default:mistakes',
      JSON.stringify([{ id: 'x', question: '有效' }, { noId: true }, null]),
    )
    expect(loadMistakes()).toHaveLength(1)
  })
})

// ---------- 筛选与排序纯函数 ----------

describe('filterMistakes / sortMistakes / mistakeTopics', () => {
  const base = [
    { id: 'a', question: 'A', answer: '', topic: '03-rag-system', createdAt: 100, reviewCount: 1 },
    { id: 'b', question: 'B', answer: '', topic: null, createdAt: 300, reviewCount: 5 },
    { id: 'c', question: 'C', answer: '', topic: '02-prompt-engineering', createdAt: 200, reviewCount: 3 },
    { id: 'd', question: 'D', answer: '', topic: '03-rag-system', createdAt: 400, reviewCount: 5 },
  ]

  it('filterMistakes：undefined 返回全部', () => {
    expect(filterMistakes(base, undefined)).toHaveLength(4)
  })
  it('filterMistakes：null 仅匹配「综合」（无主题）', () => {
    expect(filterMistakes(base, null).map((m) => m.id)).toEqual(['b'])
  })
  it('filterMistakes：指定主题精确匹配', () => {
    expect(filterMistakes(base, '03-rag-system').map((m) => m.id)).toEqual(['a', 'd'])
  })

  it('sortMistakes：recent 按 createdAt 倒序', () => {
    expect(sortMistakes(base, 'recent').map((m) => m.id)).toEqual(['d', 'b', 'c', 'a'])
  })
  it('sortMistakes：reviewCount 多的优先，并列时新的在前', () => {
    expect(sortMistakes(base, 'reviewCount').map((m) => m.id)).toEqual(['d', 'b', 'c', 'a'])
  })
  it('sortMistakes：不修改原数组', () => {
    const before = base.map((m) => m.id)
    sortMistakes(base, 'reviewCount')
    expect(base.map((m) => m.id)).toEqual(before)
  })

  it('mistakeTopics：去重、按名称排序、null（综合）排最后', () => {
    expect(mistakeTopics(base)).toEqual(['02-prompt-engineering', '03-rag-system', null])
  })
})
