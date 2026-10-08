import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHostOverrideFetch, resolveHostHeader } from '../src/main/llm/hostOverrideFetch'

let server: http.Server
let port: number
let seen: { host?: string; method?: string; body: string }

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen = { host: req.headers.host, method: req.method, body }
      res.setHeader('content-type', 'application/x-ndjson')
      res.write('{"a":1}\n')
      setTimeout(() => res.end('{"a":2}\n'), 20)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
})
afterAll(() => server.close())

describe('createHostOverrideFetch', () => {
  it('Host を差し替え、POST 本文とストリーム応答を扱える', async () => {
    const f = createHostOverrideFetch('localhost:11434')
    const res = await f(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: 1 })
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"a":1}\n{"a":2}\n')
    expect(seen).toEqual({ host: 'localhost:11434', method: 'POST', body: '{"x":1}' })
  })
  it('abort で AbortError になる', async () => {
    const f = createHostOverrideFetch('localhost:11434')
    const ac = new AbortController()
    const p = f(`http://127.0.0.1:${port}/`, { signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('resolveHostHeader', () => {
  it('ループバック宛てや無効時は付けない', () => {
    expect(resolveHostHeader('http://127.0.0.1:11434', true)).toBeUndefined()
    expect(resolveHostHeader('http://localhost:11434', true)).toBeUndefined()
    expect(resolveHostHeader('https://x.ts.net:11434', false)).toBeUndefined()
  })
  it('リモートは localhost:<port>', () => {
    expect(resolveHostHeader('https://x.ts.net:11434', true)).toBe('localhost:11434')
    expect(resolveHostHeader('https://x.ts.net', true)).toBe('localhost:443')
    expect(resolveHostHeader('http://100.1.2.3:8080', true)).toBe('localhost:8080')
  })
})
