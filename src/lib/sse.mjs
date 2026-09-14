// SSE 帧解析（纯 JS 模块，无 TS/浏览器以外依赖，便于 Node 下单测）
// 类型声明见同目录 sse.d.mts；src/lib/api.ts 复用本模块。
//
// 解析规则（对齐 SSE 规范）：
// - 帧以空行（\n\n）分隔；\r\n 在解码时统一归一化为 \n
// - 同一帧内多条 `data:` 行用 '\n' 拼接成一次事件数据后再 JSON.parse
// - 忽略注释行（以 ':' 开头）、`event:` / `id:` / `retry:` 字段行
//   （事件类型由后端放在 data JSON 的 type 字段里）
// - JSON.parse 失败不静默吞掉：调用 onError（SSE_PARSE）提示，并继续解析后续帧
// - done 帧：停止分发并调用 onDone；EOF 时若未收过 done 也兜底调 onDone（幂等，只调一次）
//
// onError 统一收结构化对象 { code, message, retryable }。

/**
 * @param {string} raw 拼接后的事件数据
 * @param {import('./sse.d.mts').StreamHandlers} handlers
 * @returns {'done'|undefined} 收到 done 帧时返回 'done'
 */
function dispatch(raw, handlers) {
  let evt
  try {
    evt = JSON.parse(raw)
  } catch {
    handlers.onError({ code: 'SSE_PARSE', message: 'SSE 数据帧解析失败', retryable: true })
    return
  }
  switch (evt?.type) {
    case 'status':
      if (typeof evt.phase === 'string') handlers.onStatus(evt.phase)
      break
    case 'sources':
      if (Array.isArray(evt.sources)) handlers.onSources(evt.sources)
      else handlers.onError({ code: 'SSE_SCHEMA', message: '来源数据格式异常', retryable: true })
      break
    case 'token':
      if (typeof evt.content === 'string') handlers.onToken(evt.content)
      break
    case 'error':
      handlers.onError({
        code: typeof evt.code === 'string' ? evt.code : 'BACKEND_ERROR',
        message: typeof evt.message === 'string' ? evt.message : '后端错误',
        retryable: evt.retryable !== false,
      })
      break
    case 'done':
      return 'done'
    default:
      break // 未知事件类型忽略
  }
  return undefined
}

/**
 * 解析一个完整帧：收集 data 行并拼接，忽略注释与其他字段行。
 * @param {string} frame
 * @param {import('./sse.d.mts').StreamHandlers} handlers
 * @returns {'done'|undefined}
 */
function processFrame(frame, handlers) {
  const dataLines = []
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue // 空行 / 注释行
    if (line.startsWith('data:')) {
      // 规范：`data:` 后最多去掉一个空格，不能再多（token 内容可能有意义的前导空格在 JSON 引号内，不受影响）
      const data = line.slice(5)
      dataLines.push(data.startsWith(' ') ? data.slice(1) : data)
    }
    // event: / id: / retry: 字段行忽略
  }
  if (dataLines.length > 0) return dispatch(dataLines.join('\n'), handlers)
  return undefined
}

/**
 * 消费一个 SSE ReadableStream，按帧解析并分发事件。
 * @param {ReadableStream<Uint8Array>} body
 * @param {import('./sse.d.mts').StreamHandlers} handlers
 * @returns {Promise<void>}
 */
export async function consumeSSE(body, handlers) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  // 上一 chunk 末尾的孤立 '\r' 挂起不送入 buffer：它可能与本 chunk 开头的 '\n' 组成 \r\n，
  // 若先归一化会把跨 chunk 的 \r\n\r\n 帧分隔符拆开，导致丢帧
  let pendingCR = false

  const finish = () => {
    if (!finished) {
      finished = true
      handlers.onDone()
    }
  }

  const drain = (flush) => {
    let idx
    while (!finished && (idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      if (processFrame(frame, handlers) === 'done') finish()
    }
    if (!finished && flush && buffer.trim()) {
      if (processFrame(buffer.replace(/\n+$/, ''), handlers) === 'done') finish()
      buffer = ''
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    let text = decoder.decode(value, { stream: true })
    if (pendingCR) {
      text = '\r' + text
      pendingCR = false
    }
    if (text.endsWith('\r')) {
      text = text.slice(0, -1)
      pendingCR = true
    }
    buffer += text.replace(/\r\n/g, '\n')
    drain(false)
  }
  let tail = decoder.decode()
  if (pendingCR) tail = '\r' + tail // 流末尾的孤立 '\r' 不可能再配成 \r\n，原样归还
  buffer += tail.replace(/\r\n/g, '\n')
  drain(true)
  finish() // EOF 兜底：连接正常结束即视为完成（幂等）
}
