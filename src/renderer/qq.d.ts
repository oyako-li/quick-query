import type { QuickQueryApi } from '../shared/ipc'

declare global {
  interface Window {
    qq: QuickQueryApi
  }
}
