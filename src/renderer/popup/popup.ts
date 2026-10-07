import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { PopupAction, PopupState } from '../../shared/ipc'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const card = $('card')
const promptBtn = $<HTMLButtonElement>('prompt-btn')
const modelLabel = $('model')
const menu = $<HTMLUListElement>('prompt-menu')
const body = $('body')
const copyBtn = $<HTMLButtonElement>('copy')
const preview = $('input-preview')
const notice = $('notice')
const errorBox = $('error')
const meta = $('meta')
const actionBtn = $<HTMLButtonElement>('error-action')

let text = ''
let pendingRender = false
let currentAction: PopupAction | null = null

function setPromptName(name: string): void {
  promptBtn.textContent = `${name} ▾`
}

async function toggleMenu(): Promise<void> {
  if (!menu.hidden) {
    menu.hidden = true
    return
  }
  const s = await window.qq.getSettings()
  menu.replaceChildren(
    ...s.prompts.map((p) => {
      const li = document.createElement('li')
      li.textContent = p.name
      if (p.id === s.currentPromptId) li.className = 'current'
      li.addEventListener('click', () => {
        menu.hidden = true
        if (p.id !== s.currentPromptId) window.qq.selectPrompt(p.id)
      })
      return li
    })
  )
  menu.hidden = false
}
promptBtn.addEventListener('click', () => void toggleMenu())
void window.qq.getSettings().then((s) => {
  const p = s.prompts.find((x) => x.id === s.currentPromptId)
  if (p) setPromptName(p.name)
})

function render(): void {
  pendingRender = false
  body.innerHTML = DOMPurify.sanitize(marked.parse(text, { async: false }) as string)
}
function scheduleRender(): void {
  if (pendingRender) return
  pendingRender = true
  requestAnimationFrame(render)
}

window.qq.onPopupToken((t) => {
  text += t
  scheduleRender()
})

window.qq.onPopupState((s: PopupState) => {
  errorBox.hidden = true
  meta.hidden = true
  notice.hidden = true
  currentAction = null

  if (s.status === 'loading') {
    text = ''
    body.textContent = ''
    body.className = 'loading'
    setPromptName(s.promptName)
    modelLabel.textContent = ''
    preview.hidden = true
    copyBtn.disabled = true
  } else if (s.status === 'streaming') {
    text = ''
    body.textContent = ''
    body.className = 'loading'
    setPromptName(s.promptName)
    modelLabel.textContent = s.model
    preview.textContent = s.inputPreview
    preview.hidden = false
    copyBtn.disabled = true
    if (s.notice) (notice.textContent = s.notice), (notice.hidden = false)
  } else if (s.status === 'done') {
    body.className = ''
    render()
    copyBtn.disabled = text.length === 0
    meta.textContent = `${(s.elapsedMs / 1000).toFixed(1)} 秒`
    meta.hidden = false
    if (s.notice) (notice.textContent = s.notice), (notice.hidden = false)
  } else {
    body.className = ''
    body.textContent = ''
    preview.hidden = true
    copyBtn.disabled = true
    $('error-msg').textContent = s.message
    $('error-hint').textContent = s.hint ?? ''
    errorBox.hidden = false
    if (s.action) {
      currentAction = s.action
      actionBtn.textContent = s.action === 'retry' ? '再試行' : '設定を開く'
      actionBtn.hidden = false
    } else {
      actionBtn.hidden = true
    }
  }
})
// 'streaming' 中はトークンが body.loading のまま積まれていくので、最初のトークンでスピナーを外す
window.qq.onPopupToken(() => body.classList.remove('loading'))

$('settings').addEventListener('click', () => window.qq.popupAction('open-settings'))
$('close').addEventListener('click', () => window.qq.closePopup())
copyBtn.addEventListener('click', () => window.qq.copyText(text))
actionBtn.addEventListener('click', () => currentAction && window.qq.popupAction(currentAction))

// 内容の自然な高さ (枠 + ヘッダー + 内容) をメインへ通知する。利用者がリサイズ済みなら main 側で無視される
const scroll = $('scroll')
const flow = $('flow')
new ResizeObserver(() => {
  const chrome = card.offsetHeight - scroll.clientHeight
  window.qq.resizePopup(Math.ceil(chrome + flow.offsetHeight))
}).observe(flow)
