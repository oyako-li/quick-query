import type { AppStatus, Prompt, Settings } from '../../shared/ipc'
import { BUILTIN_PROMPTS } from '../../shared/prompts'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const qq = window.qq

let settings: Settings
let selectedId = ''
let draftNew = false

// ---------- 状態 ----------
function renderStatus(s: AppStatus): void {
  const items: [boolean, string][] = [
    [s.watcher === 'ready', s.watcher === 'ready' ? 'キー監視: 有効' : s.watcher === 'no-permission' ? 'キー監視: 入力監視の許可が必要' : s.watcher === 'stopped' ? 'キー監視: ヘルパーを起動できません' : 'キー監視: 起動中'],
    [s.ollama.ok, s.ollama.ok ? 'Ollama: 接続OK' : `Ollama: 未接続${s.ollama.error ? ` (${s.ollama.error})` : ''}`]
  ]
  $('status').replaceChildren(
    ...items.map(([ok, label]) => {
      const li = document.createElement('li')
      li.className = ok ? 'ok' : 'ng'
      li.textContent = label
      return li
    })
  )
  const needPerm = s.watcher === 'no-permission'
  $('perm-box').hidden = !needPerm
}
qq.onStatusChanged(renderStatus)
$('open-pane').addEventListener('click', () => qq.openPermissionPane())

// ---------- 一般 ----------
async function loadModels(): Promise<void> {
  const { models, error } = await qq.listModels()
  const sel = $<HTMLSelectElement>('model')
  const names = models.includes(settings.model) || !settings.model ? models : [settings.model, ...models]
  sel.replaceChildren(
    ...[''].concat(names).map((m) => {
      const o = document.createElement('option')
      o.value = m
      o.textContent = m || '（自動: 最初のモデル）'
      return o
    })
  )
  sel.value = settings.model
  const err = $('model-error')
  err.hidden = !error
  err.textContent = error ? `モデル一覧を取得できません: ${error}` : ''
}

async function patch(p: Partial<Settings>): Promise<void> {
  settings = await qq.setSettings(p)
}

function bindGeneral(): void {
  const host = $<HTMLInputElement>('host')
  const interval = $<HTMLInputElement>('interval')
  const maxchars = $<HTMLInputElement>('maxchars')
  const enabled = $<HTMLInputElement>('enabled')
  const hosthdr = $<HTMLInputElement>('hosthdr')
  const login = $<HTMLInputElement>('login')
  host.value = settings.ollamaHost
  interval.value = String(settings.trigger.doubleCopyMs)
  maxchars.value = String(settings.maxInputChars)
  enabled.checked = settings.trigger.enabled
  hosthdr.checked = settings.localhostHostHeader
  login.checked = settings.launchAtLogin

  $('model').addEventListener('change', (e) => void patch({ model: (e.target as HTMLSelectElement).value }))
  host.addEventListener('change', async () => {
    await patch({ ollamaHost: host.value })
    host.value = settings.ollamaHost
    void loadModels()
    renderStatus(await qq.getStatus())
  })
  interval.addEventListener('change', async () => {
    await patch({ trigger: { ...settings.trigger, doubleCopyMs: Number(interval.value) } })
    interval.value = String(settings.trigger.doubleCopyMs)
  })
  maxchars.addEventListener('change', async () => {
    await patch({ maxInputChars: Number(maxchars.value) })
    maxchars.value = String(settings.maxInputChars)
  })
  enabled.addEventListener('change', () => void patch({ trigger: { ...settings.trigger, enabled: enabled.checked } }))
  hosthdr.addEventListener('change', async () => {
    await patch({ localhostHostHeader: hosthdr.checked })
    void loadModels()
    renderStatus(await qq.getStatus())
  })
  login.addEventListener('change', () => void patch({ launchAtLogin: login.checked }))
}

// ---------- プロンプト ----------
const current = (): Prompt | undefined => settings.prompts.find((p) => p.id === selectedId)

function renderPrompts(): void {
  $('prompt-list').replaceChildren(
    ...settings.prompts.map((p) => {
      const li = document.createElement('li')
      li.textContent = p.name
      if (p.id === selectedId && !draftNew) li.classList.add('sel')
      if (p.id === settings.currentPromptId) {
        const b = document.createElement('span')
        b.className = 'badge'
        b.textContent = '使用中'
        li.append(b)
      }
      li.addEventListener('click', () => select(p.id))
      return li
    })
  )
  const p = draftNew ? undefined : current()
  const builtin = !!p?.builtin
  const def = BUILTIN_PROMPTS.find((d) => d.id === p?.id)
  const modified = !!p && !!def && (p.name !== def.name || p.system !== def.system || p.userTemplate !== def.userTemplate)
  $<HTMLButtonElement>('p-del').disabled = builtin || draftNew
  $<HTMLButtonElement>('p-dup').disabled = draftNew
  $<HTMLButtonElement>('p-reset').hidden = !builtin
  $<HTMLButtonElement>('p-reset').disabled = !modified
  $<HTMLButtonElement>('p-use').disabled = draftNew || p?.id === settings.currentPromptId
  $('p-msg').textContent = builtin ? (modified ? '組込みプリセット（編集済み）' : '組込みプリセット') : ''
}

function select(id: string): void {
  draftNew = false
  selectedId = id
  const p = current()
  if (p) {
    $<HTMLInputElement>('p-name').value = p.name
    $<HTMLTextAreaElement>('p-system').value = p.system
    $<HTMLTextAreaElement>('p-user').value = p.userTemplate
  }
  renderPrompts()
}

function formPrompt(id: string, builtin = false): Prompt {
  return {
    id,
    name: $<HTMLInputElement>('p-name').value.trim(),
    system: $<HTMLTextAreaElement>('p-system').value,
    userTemplate: $<HTMLTextAreaElement>('p-user').value,
    builtin
  }
}

function bindPrompts(): void {
  $('p-new').addEventListener('click', () => {
    draftNew = true
    $<HTMLInputElement>('p-name').value = ''
    $<HTMLTextAreaElement>('p-system').value = ''
    $<HTMLTextAreaElement>('p-user').value = '{{text}}'
    renderPrompts()
  })
  $('p-dup').addEventListener('click', () => {
    const p = current()
    if (!p) return
    draftNew = true
    $<HTMLInputElement>('p-name').value = `${p.name} のコピー`
    renderPrompts()
  })
  $('p-save').addEventListener('click', async () => {
    const p = formPrompt(draftNew ? crypto.randomUUID() : selectedId, !draftNew && !!current()?.builtin)
    if (!p.name) return void ($('p-msg').textContent = '名前を入力してください')
    if (!p.userTemplate.includes('{{text}}')) return void ($('p-msg').textContent = 'User テンプレートに {{text}} が必要です')
    const prompts = draftNew ? [...settings.prompts, p] : settings.prompts.map((x) => (x.id === p.id ? p : x))
    await patch({ prompts })
    draftNew = false
    select(p.id)
    $('p-msg').textContent = '保存しました'
  })
  $('p-del').addEventListener('click', async () => {
    const p = current()
    if (!p || p.builtin) return
    await patch({ prompts: settings.prompts.filter((x) => x.id !== p.id) })
    select(settings.currentPromptId)
  })
  $('p-reset').addEventListener('click', async () => {
    const def = BUILTIN_PROMPTS.find((d) => d.id === selectedId)
    if (!def) return
    await patch({ prompts: settings.prompts.map((x) => (x.id === def.id ? def : x)) })
    select(def.id)
    $('p-msg').textContent = '初期値に戻しました'
  })
  $('p-use').addEventListener('click', async () => {
    await patch({ currentPromptId: selectedId })
    renderPrompts()
  })
}

// ---------- 起動 ----------
void (async () => {
  settings = await qq.getSettings()
  selectedId = settings.currentPromptId
  bindGeneral()
  bindPrompts()
  select(selectedId)
  renderStatus(await qq.getStatus())
  await loadModels()
})()
