import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { IPC, type PopupState } from '../../shared/ipc'
import { computePopupPosition } from './position'

const DEFAULT_WIDTH = 440
const MIN_HEIGHT = 96

export class PopupWindow {
  private win: BrowserWindow | null = null
  private ready: Promise<void> = Promise.resolve()
  private cursor = { x: 0, y: 0 }
  private width = DEFAULT_WIDTH
  private height = MIN_HEIGHT
  /** 利用者がリサイズした。以後は内容に合わせた自動リサイズをしない。非表示で解除 */
  private userSized = false
  /** 最後にプログラムが置いた位置。これとズレたら利用者がドラッグした */
  private placed = { x: 0, y: 0 }
  /** ドラッグ後は位置を保つ (リサイズでカーソル位置へ戻さない)。非表示で解除 */
  private userMoved = false

  private create(): BrowserWindow {
    const win = new BrowserWindow({
      width: DEFAULT_WIDTH,
      height: MIN_HEIGHT,
      minWidth: 300,
      minHeight: MIN_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: true,
      resizable: true,
      movable: true,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false, // フォーカスを奪わない
      type: 'panel', // macOS: non-activating panel
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.on('move', () => {
      const [x = 0, y = 0] = win.getPosition()
      if (Math.abs(x - this.placed.x) > 2 || Math.abs(y - this.placed.y) > 2) {
        if (process.env['QQ_DEBUG']) console.log('[qq] user move', { x, y })
        this.userMoved = true
        this.placed = { x, y }
      }
    })
    win.on('resize', () => {
      const [w = 0, h = 0] = win.getSize()
      if (Math.abs(w - this.width) > 2 || Math.abs(h - this.height) > 2) {
        this.userSized = true
        this.width = w
        this.height = h
      }
    })
    win.on('closed', () => (this.win = null))

    this.ready = new Promise((resolve) => win.webContents.once('did-finish-load', () => resolve()))
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) void win.loadURL(`${devUrl}/popup/index.html`)
    else void win.loadFile(join(__dirname, '../renderer/popup/index.html'))
    return win
  }

  get visible(): boolean {
    return !!this.win && this.win.isVisible()
  }

  /** 非表示から表示するときだけカーソル位置を取り直す。表示中は位置を保つ */
  async show(state: PopupState): Promise<void> {
    if (!this.win) this.win = this.create()
    const win = this.win
    await this.ready
    if (win.isDestroyed()) return
    if (!win.isVisible()) {
      this.cursor = screen.getCursorScreenPoint()
      this.width = DEFAULT_WIDTH
      this.height = MIN_HEIGHT
      this.userMoved = false
      this.userSized = false
      this.place()
      win.webContents.send(IPC.popupState, state)
      win.showInactive()
    } else {
      win.webContents.send(IPC.popupState, state)
    }
  }

  setState(state: PopupState): void {
    this.win?.webContents.send(IPC.popupState, state)
  }

  sendToken(token: string): void {
    this.win?.webContents.send(IPC.popupToken, token)
  }

  resize(contentHeight: number): void {
    if (!this.win || this.win.isDestroyed() || this.userSized) return
    const area = screen.getDisplayNearestPoint(this.cursor).workArea
    this.height = Math.round(Math.min(Math.max(contentHeight, MIN_HEIGHT), area.height * 0.6))
    this.place()
  }

  hide(): void {
    this.win?.hide()
  }

  private place(): void {
    if (!this.win || this.win.isDestroyed()) return
    const size = { width: this.width, height: this.height }
    let pos: { x: number; y: number }
    if (this.userMoved) {
      // 移動後は左上を固定し、はみ出す分だけ画面内へ戻す
      const area = screen.getDisplayNearestPoint(this.placed).workArea
      pos = {
        x: Math.max(area.x, Math.min(this.placed.x, area.x + area.width - size.width)),
        y: Math.max(area.y, Math.min(this.placed.y, area.y + area.height - size.height))
      }
    } else {
      pos = computePopupPosition(this.cursor, size, screen.getDisplayNearestPoint(this.cursor).workArea)
    }
    if (process.env['QQ_DEBUG']) console.log('[qq] place', { userMoved: this.userMoved, pos, h: this.height })
    this.placed = pos
    this.win.setBounds({ ...pos, ...size })
  }
}
