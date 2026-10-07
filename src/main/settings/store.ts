import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings } from '../../shared/ipc'
import { normalizeSettings } from './schema'

/** userData/settings.json への単純な永続化。書き込みは tmp → rename で原子的に行う */
export class SettingsStore {
  private file = join(app.getPath('userData'), 'settings.json')
  private value: Settings

  constructor() {
    let raw: unknown = undefined
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      /* 初回 or 破損: 既定値で開始 */
    }
    this.value = normalizeSettings(raw)
  }

  get(): Settings {
    return this.value
  }

  update(patch: Partial<Settings>): Settings {
    this.value = normalizeSettings({ ...this.value, ...patch })
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.value, null, 2))
    renameSync(tmp, this.file)
    return this.value
  }
}
