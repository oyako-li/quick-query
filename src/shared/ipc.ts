// main / preload / renderer 共有の IPC 定義。ここに無いチャンネルは使わない。

export type Prompt = {
  id: string
  name: string
  system: string
  userTemplate: string
  builtin: boolean
}

export type Settings = {
  version: 1
  model: string
  ollamaHost: string
  /** リモート Ollama が Host 検査で 403 を返すときのため、Host: localhost を付ける */
  localhostHostHeader: boolean
  currentPromptId: string
  prompts: Prompt[]
  trigger: { enabled: boolean; doubleCopyMs: number }
  maxInputChars: number
  launchAtLogin: boolean
}

export type PopupAction = 'open-settings' | 'retry'

export type PopupState =
  | { status: 'loading'; promptName: string; inputPreview?: string }
  | { status: 'streaming'; promptName: string; model: string; inputPreview: string; notice?: string }
  | { status: 'done'; promptName: string; model: string; inputPreview: string; elapsedMs: number; notice?: string }
  | { status: 'error'; message: string; hint?: string; action?: PopupAction }

export type AppStatus = {
  watcher: 'starting' | 'ready' | 'no-permission' | 'stopped'
  ollama: { ok: boolean; error?: string }
  paused: boolean
}

export const IPC = {
  popupState: 'popup:state',
  popupToken: 'popup:token',
  popupClose: 'popup:close',
  popupCopy: 'popup:copy',
  popupResize: 'popup:resize',
  popupAction: 'popup:action',
  popupSelectPrompt: 'popup:select-prompt',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  ollamaModels: 'ollama:models',
  statusGet: 'status:get',
  statusChanged: 'status:changed',
  openPermissionPane: 'permission:open'
} as const

export type QuickQueryApi = {
  // popup
  onPopupState(cb: (s: PopupState) => void): void
  onPopupToken(cb: (t: string) => void): void
  closePopup(): void
  copyText(text: string): void
  resizePopup(height: number): void
  popupAction(action: PopupAction): void
  selectPrompt(id: string): void
  // settings
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  listModels(): Promise<{ models: string[]; error?: string }>
  getStatus(): Promise<AppStatus>
  onStatusChanged(cb: (s: AppStatus) => void): void
  openPermissionPane(): void
}
