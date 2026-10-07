import { BrowserWindow, app } from 'electron'
import { join } from 'node:path'

let win: BrowserWindow | null = null

export function openSettingsWindow(): void {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return
  }
  win = new BrowserWindow({
    width: 760,
    height: 640,
    title: 'Quick Query 設定',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.on('closed', () => (win = null))
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}/settings/index.html`)
  else void win.loadFile(join(__dirname, '../renderer/settings/index.html'))
  app.focus({ steal: true })
}
