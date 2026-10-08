import { Ollama } from 'ollama'
import { createHostOverrideFetch, resolveHostHeader } from './hostOverrideFetch'

export type LlmErrorKind = 'unreachable' | 'model-missing' | 'aborted' | 'other'

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string
  ) {
    super(message)
  }
}

export function classifyError(e: unknown, signal?: AbortSignal): LlmError {
  if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) return new LlmError('aborted', 'aborted')
  const msg = e instanceof Error ? e.message : String(e)
  const cause = (e as { cause?: { code?: string } } | undefined)?.cause
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(msg) || cause?.code === 'ECONNREFUSED') {
    return new LlmError('unreachable', 'Ollama に接続できません')
  }
  if (/not found/i.test(msg) && /model/i.test(msg)) return new LlmError('model-missing', msg)
  return new LlmError('other', msg)
}

export class LlmService {
  private client: Ollama
  private key: string

  constructor(
    private host: string,
    private localhostHostHeader = true
  ) {
    this.key = `${host}|${localhostHostHeader}`
    this.client = this.make()
  }

  private make(): Ollama {
    const hostHeader = resolveHostHeader(this.host, this.localhostHostHeader)
    return new Ollama({ host: this.host, ...(hostHeader ? { fetch: createHostOverrideFetch(hostHeader) } : {}) })
  }

  /** 接続先の設定を反映する。変更が無ければ何もしない */
  configure(host: string, localhostHostHeader: boolean): void {
    const key = `${host}|${localhostHostHeader}`
    if (key === this.key) return
    this.key = key
    this.host = host
    this.localhostHostHeader = localhostHostHeader
    this.client = this.make()
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await this.client.list()
      return res.models.map((m) => m.name)
    } catch (e) {
      throw classifyError(e)
    }
  }

  /** トークンを逐次 yield。signal.abort() で Ollama 側の生成も止める */
  async *stream(
    model: string,
    messages: { role: 'system' | 'user'; content: string }[],
    signal: AbortSignal
  ): AsyncGenerator<string> {
    const onAbort = () => this.client.abort()
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const iter = await this.client.chat({ model, messages, stream: true })
      for await (const part of iter) {
        if (part.message.content) yield part.message.content
      }
    } catch (e) {
      throw classifyError(e, signal)
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }
}
