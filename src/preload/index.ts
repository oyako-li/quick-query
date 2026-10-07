import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type QuickQueryApi } from '../shared/ipc'

const api: QuickQueryApi = {
  onPopupState: (cb) => ipcRenderer.on(IPC.popupState, (_e, s) => cb(s)),
  onPopupToken: (cb) => ipcRenderer.on(IPC.popupToken, (_e, t) => cb(t)),
  closePopup: () => ipcRenderer.send(IPC.popupClose),
  copyText: (text) => ipcRenderer.send(IPC.popupCopy, text),
  resizePopup: (h) => ipcRenderer.send(IPC.popupResize, h),
  popupAction: (a) => ipcRenderer.send(IPC.popupAction, a),
  selectPrompt: (id) => ipcRenderer.send(IPC.popupSelectPrompt, id),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  listModels: () => ipcRenderer.invoke(IPC.ollamaModels),
  getStatus: () => ipcRenderer.invoke(IPC.statusGet),
  onStatusChanged: (cb) => ipcRenderer.on(IPC.statusChanged, (_e, s) => cb(s)),
  openPermissionPane: () => ipcRenderer.send(IPC.openPermissionPane)
}

contextBridge.exposeInMainWorld('qq', api)
