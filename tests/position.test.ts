import { describe, expect, it } from 'vitest'
import { computePopupPosition } from '../src/main/windows/position'

const area = { x: 0, y: 0, width: 1440, height: 900 }
const size = { width: 440, height: 200 }

describe('computePopupPosition', () => {
  it('通常はカーソルの右下', () => {
    expect(computePopupPosition({ x: 100, y: 100 }, size, area)).toEqual({ x: 114, y: 114 })
  })
  it('右端では左へ反転', () => {
    expect(computePopupPosition({ x: 1400, y: 100 }, size, area).x).toBe(1400 - 14 - 440)
  })
  it('下端では上へ反転', () => {
    expect(computePopupPosition({ x: 100, y: 850 }, size, area).y).toBe(850 - 14 - 200)
  })
  it('2枚目のディスプレイ (オフセットあり) でも収まる', () => {
    const second = { x: 1440, y: -100, width: 1920, height: 1080 }
    const p = computePopupPosition({ x: 3350, y: 900 }, size, second)
    expect(p.x + size.width).toBeLessThanOrEqual(second.x + second.width)
    expect(p.y + size.height).toBeLessThanOrEqual(second.y + second.height)
  })
  it('小さい領域でも workArea 内にクランプ', () => {
    const p = computePopupPosition({ x: 5, y: 5 }, size, { x: 0, y: 0, width: 300, height: 150 })
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.y).toBeGreaterThanOrEqual(0)
  })
})
