import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, buildMessages, normalizeSettings } from '../src/main/settings/schema'

describe('normalizeSettings', () => {
  it('空入力は既定値', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  })
  it('壊れたフィールドだけ既定値に戻す', () => {
    const s = normalizeSettings({ model: 'x', ollamaHost: 'not a url', trigger: { enabled: true, doubleCopyMs: 99999 } })
    expect(s.model).toBe('x')
    expect(s.ollamaHost).toBe(DEFAULT_SETTINGS.ollamaHost)
    expect(s.trigger.doubleCopyMs).toBe(DEFAULT_SETTINGS.trigger.doubleCopyMs)
  })
  it('組込みプロンプトは常に存在する', () => {
    const s = normalizeSettings({ prompts: [] })
    expect(s.prompts.filter((p) => p.builtin).map((p) => p.id)).toEqual(['translate', 'summarize', 'explain-code'])
  })
  it('組込みプロンプトの編集内容を保持し、builtin のまま', () => {
    const s = normalizeSettings({ prompts: [{ id: 'translate', name: '英訳', system: 'to English', userTemplate: '>> {{text}}', builtin: false }] })
    const t = s.prompts.find((p) => p.id === 'translate')!
    expect(t).toMatchObject({ name: '英訳', system: 'to English', userTemplate: '>> {{text}}', builtin: true })
    expect(s.prompts.filter((p) => p.builtin)).toHaveLength(3)
  })
  it('組込みの編集内容が不正なら初期値に戻る', () => {
    const s = normalizeSettings({ prompts: [{ id: 'translate', name: 'x', system: '', userTemplate: 'no placeholder' }] })
    expect(s.prompts.find((p) => p.id === 'translate')?.name).toBe('翻訳（日本語へ）')
  })
  it('{{text}} の無いカスタムプロンプトは捨てる', () => {
    const s = normalizeSettings({ prompts: [{ id: 'c', name: 'c', system: '', userTemplate: 'no placeholder' }] })
    expect(s.prompts.some((p) => p.id === 'c')).toBe(false)
  })
  it('存在しない currentPromptId は translate に戻す', () => {
    expect(normalizeSettings({ currentPromptId: 'gone' }).currentPromptId).toBe('translate')
  })
  it('カスタムプロンプトを保持する', () => {
    const c = { id: 'c', name: 'c', system: 's', userTemplate: 'Q: {{text}}', builtin: true }
    const got = normalizeSettings({ prompts: [c], currentPromptId: 'c' })
    expect(got.currentPromptId).toBe('c')
    expect(got.prompts.find((p) => p.id === 'c')?.builtin).toBe(false)
  })
})

describe('buildMessages', () => {
  it('{{text}} を全て置換し、$ を特殊扱いしない', () => {
    const m = buildMessages({ id: 'a', name: 'a', system: 'S', userTemplate: '[{{text}}]/[{{text}}]', builtin: false }, 'a $& b')
    expect(m).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: '[a $& b]/[a $& b]' }
    ])
  })
})
