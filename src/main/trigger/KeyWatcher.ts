import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'

export type WatcherEvent =
  | { type: 'ready' }
  | { type: 'error'; code: string }
  | { type: 'copy'; id: number; t: number }
  | { type: 'copied'; id: number; changed: boolean }
  | { type: 'key'; code: number; t: number }

export const KEY_ESCAPE = 53

type Waiter = (changed: boolean) => void

/** Swift ヘルパー (keywatch) を子プロセスとして起動し、JSON Lines を型付きイベントにする */
export class KeyWatcher extends EventEmitter {
  private child: ChildProcess | null = null
  private results = new Map<number, boolean>()
  private waiters = new Map<number, Waiter>()
  private stopping = false

  constructor(private readonly helperPath: string) {
    super()
  }

  start(): void {
    this.stopping = false
    const child = spawn(this.helperPath, [], { stdio: ['ignore', 'pipe', 'inherit'] })
    this.child = child
    createInterface({ input: child.stdout! }).on('line', (line) => this.handleLine(line))
    child.on('error', (e) => this.emit('event', { type: 'error', code: `spawn-failed:${e.message}` } satisfies WatcherEvent))
    child.on('exit', (code) => {
      this.child = null
      if (!this.stopping && code !== 2) this.emit('exit', code)
    })
  }

  stop(): void {
    this.stopping = true
    this.child?.kill()
    this.child = null
  }

  /** id 番目の Cmd+C でクリップボードが実際に更新されたかを待つ。タイムアウト時は false */
  waitCopied(id: number, timeoutMs: number): Promise<boolean> {
    const known = this.results.get(id)
    if (known !== undefined) return Promise.resolve(known)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id)
        resolve(false)
      }, timeoutMs)
      this.waiters.set(id, (changed) => {
        clearTimeout(timer)
        resolve(changed)
      })
    })
  }

  private handleLine(line: string): void {
    let ev: WatcherEvent
    try {
      ev = JSON.parse(line) as WatcherEvent
    } catch {
      return
    }
    if (ev.type === 'copied') {
      this.results.set(ev.id, ev.changed)
      if (this.results.size > 32) this.results.delete(this.results.keys().next().value!)
      const w = this.waiters.get(ev.id)
      if (w) {
        this.waiters.delete(ev.id)
        w(ev.changed)
      }
    }
    this.emit('event', ev)
  }
}
