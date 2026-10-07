import { describe, expect, it } from 'vitest'
import { DoubleCopyDetector } from '../src/main/trigger/DoubleCopyDetector'

const make = (ms = 400) => new DoubleCopyDetector({ intervalMs: () => ms, cooldownMs: 600 })

describe('DoubleCopyDetector', () => {
  it('1回目は発火しない', () => {
    expect(make().onCopyKey(1000)).toBe(false)
  })
  it('間隔内の2回目で発火する', () => {
    const d = make()
    d.onCopyKey(1000)
    expect(d.onCopyKey(1300)).toBe(true)
  })
  it('境界 (ちょうど間隔) は発火、超えると発火しない', () => {
    const a = make()
    a.onCopyKey(0)
    expect(a.onCopyKey(400)).toBe(true)
    const b = make()
    b.onCopyKey(0)
    expect(b.onCopyKey(401)).toBe(false)
  })
  it('間隔超過の2回目は新しい1回目として扱う', () => {
    const d = make()
    d.onCopyKey(0)
    d.onCopyKey(1000)
    expect(d.onCopyKey(1200)).toBe(true)
  })
  it('間に他のキーが入るとリセット', () => {
    const d = make()
    d.onCopyKey(0)
    d.onOtherKey()
    expect(d.onCopyKey(100)).toBe(false)
  })
  it('発火後はクールダウン中の連打を無視し、1回目にも数えない', () => {
    const d = make()
    d.onCopyKey(0)
    expect(d.onCopyKey(100)).toBe(true)
    expect(d.onCopyKey(200)).toBe(false)
    expect(d.onCopyKey(300)).toBe(false) // 3回目以降が連鎖発火しない
  })
  it('クールダウン後は再び使える', () => {
    const d = make()
    d.onCopyKey(0)
    d.onCopyKey(100)
    d.onCopyKey(800)
    expect(d.onCopyKey(900)).toBe(true)
  })
  it('間隔設定の変更を即時反映する', () => {
    let ms = 400
    const d = new DoubleCopyDetector({ intervalMs: () => ms })
    d.onCopyKey(0)
    ms = 100
    expect(d.onCopyKey(200)).toBe(false)
  })
})
