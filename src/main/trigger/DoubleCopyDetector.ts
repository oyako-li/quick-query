export type DoubleCopyOptions = {
  /** 1 回目と 2 回目の最大間隔 (ms) */
  intervalMs: () => number
  /** 発火後に次の発火を無視する時間 (ms) */
  cooldownMs?: number
}

/**
 * Cmd+C の押下列から「Cmd+C+C」を判定する純ロジック。Electron 非依存。
 * 1 回目は何もせず記録、間隔内の 2 回目で true を返す。間に他キーがあればリセット。
 */
export class DoubleCopyDetector {
  private firstAt: number | null = null
  private cooldownUntil = 0
  private readonly cooldownMs: number

  constructor(private readonly opts: DoubleCopyOptions) {
    this.cooldownMs = opts.cooldownMs ?? 600
  }

  /** Cmd+C 押下 (リピートは呼び出し側で除外済み)。2 回目なら true */
  onCopyKey(t: number): boolean {
    if (t < this.cooldownUntil) {
      this.firstAt = null
      return false
    }
    if (this.firstAt !== null && t - this.firstAt <= this.opts.intervalMs()) {
      this.firstAt = null
      this.cooldownUntil = t + this.cooldownMs
      return true
    }
    this.firstAt = t
    return false
  }

  /** C 以外のキーが押された */
  onOtherKey(): void {
    this.firstAt = null
  }

  reset(): void {
    this.firstAt = null
    this.cooldownUntil = 0
  }
}
