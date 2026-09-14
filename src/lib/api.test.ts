// API 层：只测请求构造与错误路径，mock fetch，不碰真网络
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchHealth, fetchStats, streamChat } from './api'
import type { ChatRequest, Health, Stats } from '@/types'
import type { StreamHandlers } from './sse.mjs'

const enc = new TextEncoder()

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const p of chunks) c.enqueue(enc.encode(p))
      c.close()
    },
  })
}

function fakeResponse(over: Record<string, unknown>): Response {
  return { ok: true, status: 200, ...over } as unknown as Response
}

function noopHandlers(over: Partial<StreamHandlers> = {}): StreamHandlers {
  return {
    onStatus: () => {},
    onSources: () => {},
    onToken: () => {},
    onError: () => {},
    onDone: () => {},
    ...over,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchStats', () => {
  it('GET /api/stats，成功时返回解析后的 JSON', async () => {
    const stats: Stats = {
      chunks: 2787,
      llm_model: 'qwen2.5:3b',
      embed_model: 'bge',
      topics: [{ name: '03-rag-system', count: 119 }],
    }
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ json: async () => stats }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchStats()).resolves.toEqual(stats)
    expect(fetchMock).toHaveBeenCalledWith('/api/stats')
  })

  it('HTTP 非 2xx 抛带状态码的错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 503 })))
    await expect(fetchStats()).rejects.toThrow('HTTP 503')
  })

  it('chunks 不是 number 时抛格式异常', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({
          json: async () => ({ chunks: '2787', llm_model: 'm', embed_model: 'e', topics: [] }),
        }),
      ),
    )
    await expect(fetchStats()).rejects.toThrow('GET /api/stats 返回格式异常')
  })

  it('topics 不是数组时抛格式异常', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({
          json: async () => ({ chunks: 2787, llm_model: 'm', embed_model: 'e', topics: null }),
        }),
      ),
    )
    await expect(fetchStats()).rejects.toThrow('GET /api/stats 返回格式异常')
  })
})

describe('fetchHealth', () => {
  it('GET /api/health，成功时返回解析后的 JSON', async () => {
    const health: Health = {
      status: 'ready',
      index: { ok: true, chunks: 2787, error: null },
      llm: { ok: true, model: 'qwen2.5:3b', base: 'http://localhost:11434', error: null },
    }
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ json: async () => health }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchHealth()).resolves.toEqual(health)
    expect(fetchMock).toHaveBeenCalledWith('/api/health')
  })

  it('HTTP 非 2xx 抛带状态码的错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 500 })))
    await expect(fetchHealth()).rejects.toThrow('HTTP 500')
  })
})

describe('streamChat', () => {
  const req: ChatRequest = {
    question: '什么是 RAG？',
    k: 5,
    mode: 'interview',
    topic: '03-rag-system',
    history: [{ role: 'user', content: '上一个问题' }],
  }

  it('POST /api/chat：方法、头部、请求体（含 topic/history）与 signal 正确传递', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({ body: streamOf(['data: {"type":"done"}\n\n']) }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const ctrl = new AbortController()

    await streamChat(req, ctrl.signal, noopHandlers())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/chat')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init.signal).toBe(ctrl.signal)
    // 请求体逐字段还原（回归防护：qa/interview 都应原样传 topic 与 history）
    expect(JSON.parse(init.body as string)).toEqual(req)
  })

  it('响应流被交给 SSE 解析器分发事件', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({
          body: streamOf([
            'data: {"type":"status","phase":"retrieving"}\n\n' +
              'data: {"type":"sources","sources":[{"title":"t","text":"x","source":"s","score":0.9}]}\n\n' +
              'data: {"type":"token","content":"答"}\n\n' +
              'data: {"type":"done"}\n\n',
          ]),
        }),
      ),
    )
    const seen: string[] = []
    await streamChat(
      req,
      new AbortController().signal,
      noopHandlers({
        onStatus: (p) => seen.push(`status:${p}`),
        onSources: (s) => seen.push(`sources:${s.length}`),
        onToken: (t) => seen.push(`token:${t}`),
        onError: (e) => seen.push(`error:${e.message}`),
        onDone: () => seen.push('done'),
      }),
    )
    expect(seen).toEqual(['status:retrieving', 'sources:1', 'token:答', 'done'])
  })

  it('HTTP 非 2xx 抛带状态码的错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 422 })))
    await expect(
      streamChat(req, new AbortController().signal, noopHandlers()),
    ).rejects.toThrow('HTTP 422')
  })

  it('响应没有 body 时抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ body: null })))
    await expect(
      streamChat(req, new AbortController().signal, noopHandlers()),
    ).rejects.toThrow('响应没有 body')
  })
})
