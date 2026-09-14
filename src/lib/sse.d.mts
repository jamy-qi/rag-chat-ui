import type { SSEEvent, StreamError, StreamPhase } from '../types'

export type StreamErrorPayload = StreamError

export interface StreamHandlers {
  onStatus: (phase: StreamPhase) => void
  onSources: (sources: Extract<SSEEvent, { type: 'sources' }>['sources']) => void
  onToken: (content: string) => void
  onError: (error: StreamErrorPayload) => void
  onDone: () => void
}

export declare function consumeSSE(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
): Promise<void>
