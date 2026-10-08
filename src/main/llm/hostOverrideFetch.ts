import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'

/**
 * Host ヘッダーを差し替える fetch。
 * Ollama は 127.0.0.1 待受のとき Host が localhost 系でない要求を 403 にする。
 * Tailscale serve などで中継するリモート Ollama を使うため、Host だけ偽装し、TLS の SNI は実ホスト名のままにする。
 * (組込み fetch は Host を上書きできず、https.request は Host から SNI を作って TLS が失敗するため自前実装)
 */
export function createHostOverrideFetch(hostHeader: string): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      const isHttps = url.protocol === 'https:'
      const headers: Record<string, string> = {}
      new Headers(init?.headers).forEach((v, k) => (headers[k] = v))
      headers['host'] = hostHeader

      const signal = init?.signal ?? undefined
      const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
      if (signal?.aborted) return reject(abortError())

      const req = (isHttps ? https : http).request(
        url,
        { method: init?.method ?? 'GET', headers, ...(isHttps ? { servername: url.hostname } : {}) },
        (res) => {
          const outHeaders = new Headers()
          for (const [k, v] of Object.entries(res.headers)) {
            for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) outHeaders.append(k, item)
          }
          const status = res.statusCode ?? 0
          const bodyless = status === 204 || status === 304
          resolve(
            new Response(bodyless ? null : (Readable.toWeb(res) as unknown as ReadableStream), {
              status,
              statusText: res.statusMessage ?? '',
              headers: outHeaders
            })
          )
        }
      )
      req.on('error', reject)
      signal?.addEventListener('abort', () => req.destroy(abortError()), { once: true })
      const body = init?.body
      if (body == null) req.end()
      else req.end(typeof body === 'string' ? body : Buffer.from(body as ArrayBuffer))
    })) as typeof fetch
}

/** 設定から実際に付ける Host ヘッダー値を決める。ループバック宛て・無効時は undefined */
export function resolveHostHeader(ollamaHost: string, enabled: boolean): string | undefined {
  if (!enabled) return undefined
  let u: URL
  try {
    u = new URL(ollamaHost)
  } catch {
    return undefined
  }
  const h = u.hostname
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1') return undefined
  const port = u.port || (u.protocol === 'https:' ? '443' : '80')
  return `localhost:${port}`
}
