import { app, BrowserWindow, Menu, Tray, clipboard, ipcMain, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { IPC, type AppStatus, type PopupAction, type Settings } from '../shared/ipc'
import { LlmError, LlmService } from './llm/ollama'
import { Orchestrator } from './orchestrator'
import { SettingsStore } from './settings/store'
import { DoubleCopyDetector } from './trigger/DoubleCopyDetector'
import { KEY_ESCAPE, KeyWatcher, type WatcherEvent } from './trigger/KeyWatcher'
import { PopupWindow } from './windows/popup'
import { openSettingsWindow } from './windows/settings'

const INPUT_MONITORING_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent'

if (!app.requestSingleInstanceLock()) app.quit()
app.dock?.hide()

let tray: Tray | null = null
let status: AppStatus = { watcher: 'starting', ollama: { ok: false }, paused: false }
let permissionRetry: NodeJS.Timeout | null = null
let shownPermissionHelp = false

const resourcePath = (name: string) =>
  app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name)

app.whenReady().then(() => {
  const settings = new SettingsStore()
  const llm = new LlmService(settings.get().ollamaHost, settings.get().localhostHostHeader)
  const popup = new PopupWindow()
  const watcher = new KeyWatcher(resourcePath('keywatch'))
  const detector = new DoubleCopyDetector({ intervalMs: () => settings.get().trigger.doubleCopyMs })
  const orchestrator = new Orchestrator({ watcher, popup, llm, settings, getStatus: () => status })

  const broadcast = () => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.statusChanged, status)
    rebuildTray()
  }
  const setStatus = (patch: Partial<AppStatus>) => {
    status = { ...status, ...patch }
    broadcast()
  }

  async function refreshOllama(): Promise<void> {
    try {
      llm.configure(settings.get().ollamaHost, settings.get().localhostHostHeader)
      await llm.listModels()
      setStatus({ ollama: { ok: true } })
    } catch (e) {
      setStatus({ ollama: { ok: false, error: e instanceof LlmError ? e.message : String(e) } })
    }
  }

  // ---- キー監視 ----
  function startWatcher(): void {
    watcher.stop()
    watcher.start()
  }
  watcher.on('event', (ev: WatcherEvent) => {
    switch (ev.type) {
      case 'ready':
        if (permissionRetry) clearInterval(permissionRetry)
        permissionRetry = null
        setStatus({ watcher: 'ready' })
        break
      case 'error':
        if (ev.code.startsWith('spawn-failed')) {
          // 権限ではなく、ヘルパーを起動できない (同梱漏れ・実行権限など)
          console.error('[keywatch]', ev.code)
          setStatus({ watcher: 'stopped' })
          break
        }
        setStatus({ watcher: 'no-permission' })
        if (!permissionRetry) permissionRetry = setInterval(startWatcher, 3000)
        if (!shownPermissionHelp) {
          shownPermissionHelp = true
          openSettingsWindow()
        }
        break
      case 'copy':
        if (settings.get().trigger.enabled && detector.onCopyKey(ev.t)) void orchestrator.onDoubleCopy(ev.id)
        break
      case 'key':
        detector.onOtherKey()
        if (ev.code === KEY_ESCAPE && popup.visible) orchestrator.close()
        break
    }
  })
  watcher.on('exit', () => {
    setStatus({ watcher: 'stopped' })
    setTimeout(startWatcher, 1000)
  })

  // ---- IPC ----
  const applySettings = (patch: Partial<Settings>): Settings => {
    const next = settings.update(patch)
    llm.configure(next.ollamaHost, next.localhostHostHeader)
    app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
    setStatus({ paused: !next.trigger.enabled })
    return next
  }
  ipcMain.handle(IPC.settingsGet, () => settings.get())
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<Settings>) => applySettings(patch ?? {}))
  ipcMain.handle(IPC.ollamaModels, async () => {
    try {
      return { models: await llm.listModels() }
    } catch (e) {
      return { models: [], error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle(IPC.statusGet, async () => {
    await refreshOllama()
    return status
  })
  ipcMain.on(IPC.openPermissionPane, () => void shell.openExternal(INPUT_MONITORING_PANE))
  ipcMain.on(IPC.popupClose, () => orchestrator.close())
  ipcMain.on(IPC.popupCopy, (_e, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text)
  })
  ipcMain.on(IPC.popupResize, (_e, h: unknown) => {
    if (typeof h === 'number' && Number.isFinite(h)) popup.resize(h)
  })
  ipcMain.on(IPC.popupAction, (_e, action: PopupAction) => {
    if (action === 'open-settings') openSettingsWindow()
    // retry: 直近の入力テキストで再実行する
    if (action === 'retry') void orchestrator.rerun()
  })

  ipcMain.on(IPC.popupSelectPrompt, (_e, id: unknown) => {
    if (typeof id !== 'string' || !settings.get().prompts.some((p) => p.id === id)) return
    if (id === settings.get().currentPromptId) return
    applySettings({ currentPromptId: id })
    void orchestrator.rerun()
  })

  // ---- トレイ ----
  const icon = nativeImage.createFromPath(resourcePath('icon.png')).resize({ height: 18 })
  tray = new Tray(icon)
  tray.setToolTip('Quick Query')

  function rebuildTray(): void {
    if (!tray) return
    const s = settings.get()
    const watcherLabel: Record<AppStatus['watcher'], string> = {
      starting: 'キー監視: 起動中…',
      ready: 'キー監視: 有効 (Cmd+C+C)',
      'no-permission': 'キー監視: 入力監視の許可が必要',
      stopped: 'キー監視: 停止'
    }
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: watcherLabel[status.watcher], enabled: status.watcher === 'no-permission', click: () => shell.openExternal(INPUT_MONITORING_PANE) },
        { label: status.ollama.ok ? 'Ollama: 接続OK' : 'Ollama: 未接続', enabled: false },
        { type: 'separator' },
        {
          label: 'プロンプト',
          submenu: s.prompts.map((p) => ({
            label: p.name,
            type: 'radio' as const,
            checked: p.id === s.currentPromptId,
            click: () => applySettings({ currentPromptId: p.id })
          }))
        },
        {
          label: s.trigger.enabled ? '一時停止' : '再開',
          click: () => applySettings({ trigger: { ...s.trigger, enabled: !s.trigger.enabled } })
        },
        { label: '設定…', accelerator: 'CmdOrCtrl+,', click: () => openSettingsWindow() },
        { type: 'separator' },
        { label: '終了', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ])
    )
  }

  app.on('before-quit', () => watcher.stop())
  setStatus({ paused: !settings.get().trigger.enabled })
  startWatcher()
  void refreshOllama()
  setInterval(() => void refreshOllama(), 30_000)
})

// トレイ常駐: ウィンドウが全部閉じてもアプリは終了しない
app.on('window-all-closed', () => {})
app.on('second-instance', () => openSettingsWindow())
