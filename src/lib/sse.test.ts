// consumeSSE 帧解析与事件分发单测
import { describe, expect, it } from 'vitest'
import { consumeSSE } from './sse.mjs'
import type { StreamErrorPayload } from './sse.mjs'

const enc = new TextEncoder()

/** 把若干字符串片段（按 chunk 切分）包装成 ReadableStream */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const p of chunks) c.enqueue(enc.encode(p))
      c.close()
    },
  })
}

interface Collected {
  sources: unknown[][]
  text: string
  errors: string[]
  errorObjs: StreamErrorPayload[]
  statuses: string[]
  doneCount: number
}

async function run(chunks: string[]): Promise<Collected> {
  const got: Collected = { sources: [], text: '', errors: [], errorObjs: [], statuses: [], doneCount: 0 }
  await consumeSSE(streamOf(chunks), {
    onStatus: (p) => got.statuses.push(p),
    onSources: (s) => got.sources.push(s as unknown[]),
    onToken: (t) => (got.text += t),
    onError: (e) => {
      got.errorObjs.push(e)
      got.errors.push(e.message)
    },
    onDone: () => {
      got.doneCount += 1
    },
  })
  return got
}

describe('consumeSSE', () => {
  it('单帧单行 data（真实后端的帧格式）', async () => {
    const got = await run([
      'data: {"type":"sources","sources":[{"title":"t","text":"x","source":"s","score":0.7}]}\n\n' +
        'data: {"type":"token","content":"你"}\n\n' +
        'data: {"type":"token","content":"好"}\n\n' +
        'data: {"type":"done"}\n\n',
    ])
    expect(got.sources).toHaveLength(1)
    expect(got.sources[0]).toHaveLength(1)
    expect(got.sources[0][0]).toMatchObject({ score: 0.7 })
    expect(got.text).toBe('你好')
    expect(got.errors).toEqual([])
    expect(got.doneCount).toBe(1)
  })

  it('一帧多条 data 行按规范用 \\n 拼接成一次事件（pretty-printed JSON）', async () => {
    const pretty = '{\n  "type": "token",\n  "content": "拼接成功"\n}'
    const frame = pretty
      .split('\n')
      .map((l) => `data: ${l}`)
      .join('\n')
    const got = await run([frame + '\n\n'])
    expect(got.text).toBe('拼接成功')
    expect(got.errors).toEqual([])
  })

  it('跨 chunk 的不完整帧：缓冲拼接后结果不变', async () => {
    const full =
      'data: {"type":"sources","sources":[{"title":"t","text":"x","source":"s","score":0.7}]}\n\n' +
      'data: {"type":"token","content":"你"}\n\n' +
      'data: {"type":"token","content":"好"}\n\n' +
      'data: {"type":"done"}\n\n'
    const got = await run([
      full.slice(0, 23),
      full.slice(23, 60),
      full.slice(60, 61),
      full.slice(61),
    ])
    expect(got.sources).toHaveLength(1)
    expect(got.text).toBe('你好')
    expect(got.errors).toEqual([])
  })

  it('注释行（: 开头）与 event:/id: 字段行被忽略', async () => {
    const got = await run([
      ': ping\n\n' +
        'event: message\nid: 42\ndata: {"type":"token","content":"A"}\n\n' +
        ':keep-alive\ndata: {"type":"token","content":"B"}\n\n',
    ])
    expect(got.text).toBe('AB')
    expect(got.errors).toEqual([])
  })

  it('error 帧分发给 onError（结构化对象），且后续帧照常解析', async () => {
    const got = await run([
      'data: {"type":"token","content":"前半"}\n\n' +
        'data: {"type":"error","message":"LLM 挂了"}\n\n' +
        'data: {"type":"token","content":"后半"}\n\n',
    ])
    expect(got.errors).toEqual(['LLM 挂了'])
    expect(got.errorObjs[0]).toEqual({ code: 'BACKEND_ERROR', message: 'LLM 挂了', retryable: true })
    expect(got.text).toBe('前半后半')
  })

  it('error 帧携带 code/retryable 时原样透传', async () => {
    const got = await run([
      'data: {"type":"error","code":"LLM_DOWN","message":"模型不可用","retryable":false}\n\n',
    ])
    expect(got.errorObjs).toEqual([{ code: 'LLM_DOWN', message: '模型不可用', retryable: false }])
  })

  it('非法 JSON 帧不静默吞掉（报 onError）且不中断后续帧', async () => {
    const got = await run([
      'data: {这不是JSON}\n\n' + 'data: {"type":"token","content":"还在"}\n\n',
    ])
    expect(got.errors).toEqual(['SSE 数据帧解析失败'])
    expect(got.errorObjs[0].code).toBe('SSE_PARSE')
    expect(got.text).toBe('还在')
  })

  it('流末尾无空行收尾的最后一帧（flush 路径）', async () => {
    const got = await run(['data: {"type":"token","content":"尾帧"}'])
    expect(got.text).toBe('尾帧')
    expect(got.errors).toEqual([])
    expect(got.doneCount).toBe(1)
  })

  it('CRLF 分帧：\\r\\n 归一化后按 \\n\\n 切帧', async () => {
    const got = await run([
      'data: {"type":"token","content":"A"}\r\n\r\n' +
        'data: {"type":"token","content":"B"}\r\n\r\n',
    ])
    expect(got.text).toBe('AB')
    expect(got.errors).toEqual([])
  })

  it('帧分隔符 \\r\\n\\r\\n 按 …\\r | \\n\\r | \\n… 三段跨 chunk 分裂时两帧都正确解析', async () => {
    const got = await run([
      'data: {"type":"token","content":"A"}\r',
      '\n\r',
      '\ndata: {"type":"token","content":"B"}\r\n\r\n',
    ])
    expect(got.text).toBe('AB')
    expect(got.errors).toEqual([])
  })

  it('done 帧触发 onDone 恰好一次，且后续帧不再分发', async () => {
    const got = await run([
      'data: {"type":"token","content":"前"}\n\n' +
        'data: {"type":"done"}\n\n' +
        'data: {"type":"token","content":"后"}\n\n',
    ])
    expect(got.doneCount).toBe(1)
    expect(got.text).toBe('前')
    expect(got.errors).toEqual([])
  })

  it('status 事件分发给 onStatus', async () => {
    const got = await run([
      'data: {"type":"status","phase":"retrieving"}\n\n' +
        'data: {"type":"status","phase":"generating"}\n\n' +
        'data: {"type":"token","content":"A"}\n\n',
    ])
    expect(got.statuses).toEqual(['retrieving', 'generating'])
    expect(got.errors).toEqual([])
  })

  it('sources 帧缺 sources 数组字段时报一次 SSE_SCHEMA 错误', async () => {
    const got = await run([
      'data: {"type":"sources"}\n\n' + 'data: {"type":"token","content":"续"}\n\n',
    ])
    expect(got.sources).toEqual([])
    expect(got.errorObjs).toHaveLength(1)
    expect(got.errorObjs[0].code).toBe('SSE_SCHEMA')
    expect(got.text).toBe('续')
  })

  it('EOF 无 done 帧时 onDone 仍被调用一次（连接正常结束即视为完成）', async () => {
    const got = await run(['data: {"type":"token","content":"A"}\n\n'])
    expect(got.text).toBe('A')
    expect(got.doneCount).toBe(1)
  })
})
