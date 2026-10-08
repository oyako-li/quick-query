import { z } from 'zod'
import type { Prompt, Settings } from '../../shared/ipc'

import { BUILTIN_PROMPTS } from '../../shared/prompts'

const PromptSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  system: z.string(),
  userTemplate: z.string().includes('{{text}}'),
  builtin: z.boolean().default(false)
})

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  model: '',
  ollamaHost: 'http://127.0.0.1:11434',
  localhostHostHeader: true,
  currentPromptId: 'translate',
  prompts: BUILTIN_PROMPTS,
  trigger: { enabled: true, doubleCopyMs: 400 },
  maxInputChars: 8000,
  launchAtLogin: false
}

const FieldSchemas = {
  model: z.string(),
  ollamaHost: z.string().url(),
  localhostHostHeader: z.boolean(),
  currentPromptId: z.string(),
  trigger: z.object({ enabled: z.boolean(), doubleCopyMs: z.number().int().min(150).max(1000) }),
  maxInputChars: z.number().int().min(200).max(100_000),
  launchAtLogin: z.boolean()
}

/** 壊れた/欠けたフィールドだけ既定値へ戻す。組込みプロンプトは常に存在させる */
export function normalizeSettings(raw: unknown): Settings {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const out: Settings = structuredClone(DEFAULT_SETTINGS)

  for (const key of Object.keys(FieldSchemas) as (keyof typeof FieldSchemas)[]) {
    const parsed = FieldSchemas[key].safeParse(src[key])
    if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data
  }

  const userPrompts: Prompt[] = []
  if (Array.isArray(src.prompts)) {
    for (const p of src.prompts) {
      const parsed = PromptSchema.safeParse(p)
      if (parsed.success) userPrompts.push(parsed.data)
    }
  }
  // 組込みは常に存在させ、利用者の編集内容があればそれを採用する (削除は不可)
  const builtinIds = new Set(BUILTIN_PROMPTS.map((p) => p.id))
  const edited = new Map(userPrompts.map((p) => [p.id, p]))
  const builtins = BUILTIN_PROMPTS.map((def) => {
    const e = edited.get(def.id)
    return e ? { ...e, builtin: true } : def
  })
  const custom = userPrompts.filter((p) => !builtinIds.has(p.id)).map((p) => ({ ...p, builtin: false }))
  out.prompts = [...builtins, ...custom]
  if (!out.prompts.some((p) => p.id === out.currentPromptId)) out.currentPromptId = 'translate'
  return out
}

export function buildMessages(prompt: Prompt, text: string) {
  return [
    { role: 'system' as const, content: prompt.system },
    { role: 'user' as const, content: prompt.userTemplate.split('{{text}}').join(text) }
  ]
}
