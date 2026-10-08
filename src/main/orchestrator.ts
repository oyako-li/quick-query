import { clipboard } from 'electron'
import type { AppStatus, PopupState } from '../shared/ipc'
import { LlmError, type LlmService } from './llm/ollama'
import type { KeyWatcher } from './trigger/KeyWatcher'
import type { PopupWindow } from './windows/popup'
import { buildMessages } from './settings/schema'
import type { SettingsStore } from './settings/store'

const TOKEN_FLUSH_MS = 16
const debug = (...a: unknown[]) => process.env['QQ_DEBUG'] && console.log('[qq]', ...a)

/** 1 回の問い合わせ (capturing → streaming → done / error / cancelled) を管理する */
export class Orchestrator {
  private abort: AbortController | null = null
  private seq = 0
  private lastRaw: string | null = null

  constructor(
    private readonly deps: {
      watcher: KeyWatcher
      popup: PopupWindow
      llm: LlmService
      settings: SettingsStore
      getStatus: () => AppStatus
    }
  ) {}

  cancel(): void {
    this.seq++
    this.abort?.abort()
    this.abort = null
  }

  close(): void {
    this.cancel()
    this.deps.popup.hide()
  }

  /** 直近の入力テキストで、現在のプロンプトを使って再実行する (プロンプト切替・再試行) */
  async rerun(): Promise<void> {
    if (!this.lastRaw) return this.onDoubleCopy(-1) // 入力が無ければ現在のクリップボードを使う
    this.abort?.abort()
    const my = ++this.seq
    const ac = new AbortController()
    this.abort = ac
    const prompt = this.currentPrompt()
    void this.deps.popup.show({ status: 'loading', promptName: prompt.name })
    return this.run(my, ac, this.lastRaw)
  }

  private currentPrompt() {
    const s = this.deps.settings.get()
    return s.prompts.find((p) => p.id === s.currentPromptId) ?? s.prompts[0]!
  }

  async onDoubleCopy(copyId: number): Promise<void> {
    const { watcher, popup } = this.deps
    this.abort?.abort()
    const my = ++this.seq
    debug('double-copy', { copyId })
    const ac = new AbortController()
    this.abort = ac
    const stale = () => my !== this.seq

    void popup.show({ status: 'loading', promptName: this.currentPrompt().name })

    // 1. 選択の取得: 2 回目の Cmd+C でクリップボードが実際に更新されたか
    const changed = copyId < 0 ? true : await watcher.waitCopied(copyId, 700)
    if (stale()) return
    debug('copied', { changed })
    if (!changed) {
      return this.fail('選択されたテキストがありません', 'テキストを選択してから Cmd+C+C を押してください')
    }
    const raw = clipboard.readText().trim()
    if (!raw) return this.fail('コピーされた内容がテキストではありません')
    this.lastRaw = raw
    return this.run(my, ac, raw)
  }

  private async run(my: number, ac: AbortController, raw: string): Promise<void> {
    const { popup, llm, settings } = this.deps
    const stale = () => my !== this.seq
    const s = settings.get()
    const prompt = this.currentPrompt()

    let text = raw
    let notice: string | undefined
    if (text.length > s.maxInputChars) {
      text = text.slice(0, s.maxInputChars)
      notice = `長いため先頭 ${s.maxInputChars} 文字のみ送信しました`
    }
    const inputPreview = raw.length > 40 ? `${raw.slice(0, 40)}…` : raw

    // 2. モデル解決
    llm.configure(s.ollamaHost, s.localhostHostHeader)
    let model = s.model
    try {
      if (!model) {
        const models = await llm.listModels()
        if (stale()) return
        model = models.find((m) => !/embed/i.test(m)) ?? ''
        if (!model) {
          return this.fail('Ollama にモデルがありません', '`ollama pull gemma3` などで取得してください', 'open-settings')
        }
        settings.update({ model })
      }
    } catch (e) {
      if (stale()) return
      return this.failLlm(e)
    }

    // 3. ストリーミング
    debug('stream start', { model, prompt: prompt.id, chars: text.length })
    const started = Date.now()
    popup.setState({ status: 'streaming', promptName: prompt.name, model, inputPreview, notice })
    let buf = ''
    let first = false
    let timer: NodeJS.Timeout | null = null
    const flush = () => {
      timer = null
      if (buf && !stale()) popup.sendToken(buf)
      buf = ''
    }
    try {
      for await (const tok of llm.stream(model, buildMessages(prompt, text), ac.signal)) {
        if (stale()) return
        if (!buf && !first) (first = true), debug('first token', { ms: Date.now() - started })
        buf += tok
        timer ??= setTimeout(flush, TOKEN_FLUSH_MS)
      }
      if (timer) clearTimeout(timer)
      flush()
      if (stale()) return
      const done: PopupState = {
        status: 'done',
        promptName: prompt.name,
        model,
        inputPreview,
        elapsedMs: Date.now() - started,
        notice
      }
      debug('done', { ms: done.elapsedMs })
      popup.setState(done)
    } catch (e) {
      if (timer) clearTimeout(timer)
      if (stale()) return
      this.failLlm(e)
    }
  }

  private fail(message: string, hint?: string, action?: 'open-settings' | 'retry'): void {
    debug('fail', message)
    this.deps.popup.setState({ status: 'error', message, hint, action })
  }

  private failLlm(e: unknown): void {
    if (e instanceof LlmError) {
      if (e.kind === 'aborted') return
      if (e.kind === 'unreachable') {
        return this.fail('Ollama に接続できません', 'Ollama アプリ、または `ollama serve` を起動してください', 'retry')
      }
      if (e.kind === 'model-missing') {
        return this.fail('モデルが見つかりません', `\`ollama pull <モデル名>\` で取得するか、設定でモデルを選び直してください`, 'open-settings')
      }
      return this.fail('問い合わせに失敗しました', e.message)
    }
    this.fail('問い合わせに失敗しました', String(e))
  }
}
