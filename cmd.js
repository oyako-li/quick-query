import { app, BrowserWindow, globalShortcut, clipboard, screen, ipcMain, Menu } from "electron";
import { Ollama } from 'ollama';
import { exec } from 'child_process';
import { getSelectedText } from 'node-get-selected-text';
import Store from 'electron-store';

const ollama = new Ollama({
    host: 'http://127.0.0.1:11434'
});

// electron-storeを初期化
const defaultPrompt = 'You are a professional translator. Output ONLY the translation. Keep formatting.';
const store = new Store({
    defaults: {
        systemPrompt: defaultPrompt,
        savedPrompts: [
            { id: 'default', name: '翻訳', prompt: defaultPrompt }
        ],
        currentPromptId: 'default',
        selectedModel: 'cogito:14b',
        hotkey: 'Alt+Z'
    }
});

let win;
let currentTranslatedText = ''; // 現在の翻訳結果を保持
// 保存されたシステムプロンプトを読み込む
const currentPromptId = store.get('currentPromptId', 'default');
const savedPrompts = store.get('savedPrompts', []);
const currentPrompt = savedPrompts.find(p => p.id === currentPromptId);
let systemPrompt = currentPrompt ? currentPrompt.prompt : store.get('systemPrompt', defaultPrompt);
let selectedModel = store.get('selectedModel', 'cogito:14b'); // 選択されたモデル
let currentHotkey = store.get('hotkey', 'Alt+Z'); // 現在のショートカットキー
let lastCmdCAt = 0; // ダブルクリック検出用

function createWin() {
    win = new BrowserWindow({
        width: 400,
        height: 200,
        show: false,
        frame: true,
        alwaysOnTop: true,
        resizable: true,
        skipTaskbar: false,
        visibleOnAllWorkspaces: true, // すべての仮想デスクトップ（スペース）に表示
        webPreferences: { 
            nodeIntegration: true, 
            contextIsolation: false,
            webviewTag: true  // webviewタグを有効化
        }
    });

    // メニューバーを作成
    const template = [
        {
            label: 'Quick Query',
            submenu: [
                {
                    label: '設定',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => {
                        win.webContents.send('open-settings');
                    }
                },
                { type: 'separator' },
                {
                    label: '結果をコピー',
                    accelerator: 'CmdOrCtrl+Shift+C',
                    click: () => {
                        if (win && currentTranslatedText) {
                            win.webContents.send('copy-to-clipboard');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: '終了',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                    click: () => {
                        // app.quit();
                    }
                },
                {
                    label: '強制終了',
                    accelerator: 'CmdOrCtrl+Shift+Q',
                    click: () => {
                        process.exit(0);
                    }
                }
            ]
        },
        {
            label: '編集',
            submenu: [
                { role: 'undo', label: '元に戻す' },
                { role: 'redo', label: 'やり直す' },
                { type: 'separator' },
                { role: 'cut', label: '切り取り' },
                { role: 'copy', label: 'コピー' },
                { role: 'paste', label: '貼り付け' },
                { role: 'selectAll', label: 'すべて選択' }
            ]
        },
        {
            label: '表示',
            submenu: [
                { role: 'reload', label: '再読み込み' },
                { role: 'forceReload', label: '強制再読み込み' },
                { role: 'toggleDevTools', label: '開発者ツール' },
                { type: 'separator' },
                { role: 'resetZoom', label: '実際のサイズ' },
                { role: 'zoomIn', label: '拡大' },
                { role: 'zoomOut', label: '縮小' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: 'フルスクリーン' }
            ]
        },
        {
            label: 'ウィンドウ',
            submenu: [
                { role: 'minimize', label: '最小化' },
                { role: 'close', label: '閉じる' }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    // ×ボタンでウィンドウを閉じる代わりに非表示にする
    win.on('close', (event) => {
        event.preventDefault();
        win.hide();
    });

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <html><body style="margin:0;background:#1e1e1e;color:#fff;font-family:-apple-system;padding:16px;overflow-y:auto;">
      <div id="settings-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.8);z-index:100;padding:20px;box-sizing:border-box;overflow-y:auto;">
        <div style="background:rgba(25,25,25,.95);border-radius:14px;padding:20px;max-width:600px;margin:50px auto;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <div>
              <h3 style="margin:0;font-size:16px;font-weight:600;">System Configuration</h3>
              <div style="font-size:11px;opacity:.7;margin-top:4px;">現在のプロンプト: <span id="settings-prompt-name">デフォルト</span></div>
            </div>
            <button id="close-settings-btn" style="background:rgba(255,255,255,.1);border:none;color:#fff;cursor:pointer;padding:4px 12px;border-radius:6px;font-size:16px;">×</button>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-size:12px;opacity:.7;margin-bottom:8px;">ショートカットキー</label>
            <input type="text" id="hotkey-input" style="width:100%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:8px 12px;color:#fff;font-size:13px;box-sizing:border-box;" placeholder="例: Alt+Z, CmdOrCtrl+Shift+T" readonly>
            <div style="font-size:10px;opacity:.6;margin-top:4px;">キーを押して設定（例: Alt+Z, CmdOrCtrl+Shift+T）</div>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-size:12px;opacity:.7;margin-bottom:8px;">Ollamaモデル</label>
            <select id="model-select" style="width:100%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:8px 12px;color:#fff;font-size:13px;box-sizing:border-box;">
            </select>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-size:12px;opacity:.7;margin-bottom:8px;">保存済みプロンプト</label>
            <select id="prompt-select" style="width:100%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:8px 12px;color:#fff;font-size:13px;box-sizing:border-box;">
            </select>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-size:12px;opacity:.7;margin-bottom:8px;">プロンプト名（新規保存時）</label>
            <input type="text" id="prompt-name-input" style="width:100%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:8px 12px;color:#fff;font-size:13px;box-sizing:border-box;" placeholder="例: 日本語翻訳">
          </div>
          <textarea id="system-prompt-input" style="width:100%;min-height:120px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:12px;color:#fff;font-family:monospace;font-size:13px;resize:vertical;box-sizing:border-box;" placeholder="System promptを入力..."></textarea>
          <div style="display:flex;gap:8px;margin-top:12px;justify-content:space-between;align-items:center;">
            <div style="display:flex;gap:8px;">
              <button id="delete-prompt-btn" style="background:rgba(255,100,100,.8);border:none;color:#fff;cursor:pointer;padding:8px 16px;border-radius:6px;font-size:12px;transition:background .2s;" onmouseover="this.style.background='rgba(255,100,100,1)'" onmouseout="this.style.background='rgba(255,100,100,.8)'">削除</button>
              <button id="reset-prompt-btn" style="background:rgba(255,255,255,.1);border:none;color:#fff;cursor:pointer;padding:8px 16px;border-radius:6px;font-size:12px;transition:background .2s;" onmouseover="this.style.background='rgba(255,255,255,.2)'" onmouseout="this.style.background='rgba(255,255,255,.1)'">リセット</button>
              <button id="save-prompt-btn" style="background:rgba(100,150,255,.8);border:none;color:#fff;cursor:pointer;padding:8px 16px;border-radius:6px;font-size:12px;transition:background .2s;font-weight:600;" onmouseover="this.style.background='rgba(100,150,255,1)'" onmouseout="this.style.background='rgba(100,150,255,.8)'">保存</button>
            </div>
          </div>
        </div>
      </div>
      <pre id="out" style="white-space:pre-wrap;margin:0;font-size:14px;line-height:1.4"></pre>
      <div id="bottom-right-controls-container" style="position:fixed;bottom:16px;right:16px;display:flex;flex-direction:row;gap:8px;align-items:center;z-index:11;transition:transform .3s;">
        <div id="bottom-right-controls" style="display:flex;flex-direction:row;gap:8px;align-items:center;transition:opacity .3s,max-width .3s;overflow:hidden;max-width:500px;">
          <select id="bottom-prompt-select" style="background:rgba(100,150,255,.3);border:1px solid rgba(100,150,255,.4);border-radius:8px;padding:6px 12px;font-size:11px;backdrop-filter:blur(8px);pointer-events:auto;color:#fff;cursor:pointer;min-width:150px;max-width:200px;appearance:none;-webkit-appearance:none;-moz-appearance:none;background-image:url('data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'12\\' height=\\'12\\' viewBox=\\'0 0 12 12\\'><path fill=\\'%23ffffff\\' d=\\'M6 9L1 4h10z\\'/></svg>');background-repeat:no-repeat;background-position:right 8px center;padding-right:28px;">
          </select>
          <button id="copy-btn" style="width:40px;height:40px;background:rgba(100,200,100,.8);border:none;color:#fff;cursor:pointer;border-radius:50%;font-size:18px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:background .2s,transform .2s;pointer-events:auto;" onmouseover="this.style.background='rgba(100,200,100,1)';this.style.transform='scale(1.1)'" onmouseout="this.style.background='rgba(100,200,100,.8)';this.style.transform='scale(1)'" title="コピー">📋</button>
          <button id="settings-btn" style="width:40px;height:40px;background:rgba(100,150,255,.8);border:none;color:#fff;cursor:pointer;border-radius:50%;font-size:20px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:background .2s,transform .2s;pointer-events:auto;" onmouseover="this.style.background='rgba(100,150,255,1)';this.style.transform='scale(1.1)'" onmouseout="this.style.background='rgba(100,150,255,.8)';this.style.transform='scale(1)'" title="設定">⚙</button>
        </div>
        <button id="hide-controls-btn" style="width:32px;height:32px;background:rgba(255,255,255,.1);border:none;color:#fff;cursor:pointer;border-radius:6px;font-size:16px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:background .2s,transform .2s;pointer-events:auto;flex-shrink:0;" onmouseover="this.style.background='rgba(255,255,255,.2)'" onmouseout="this.style.background='rgba(255,255,255,.1)'" title="収納">›</button>
      </div>
      <script>
        const { ipcRenderer } = require("electron");
        ipcRenderer.on("set-text", (_, t) => { document.getElementById("out").textContent = t; });
        ipcRenderer.on("set-system-prompt", (_, prompt) => {
          document.getElementById("system-prompt-input").value = prompt;
        });
        ipcRenderer.on("set-saved-prompts", (_, prompts, currentId) => {
          const select = document.getElementById("prompt-select");
          const bottomSelect = document.getElementById("bottom-prompt-select");
          select.innerHTML = "";
          if (bottomSelect) bottomSelect.innerHTML = "";
          prompts.forEach(p => {
            const option = document.createElement("option");
            option.value = p.id;
            option.textContent = p.name;
            option.selected = p.id === currentId;
            select.appendChild(option);
            // 右下のセレクトボックスにも追加
            if (bottomSelect) {
              const bottomOption = document.createElement("option");
              bottomOption.value = p.id;
              bottomOption.textContent = p.name;
              bottomOption.selected = p.id === currentId;
              bottomSelect.appendChild(bottomOption);
            }
          });
          // 設定モーダル内のプロンプト名を更新
          const currentPrompt = prompts.find(p => p.id === currentId);
          if (currentPrompt) {
            const settingsPromptNameEl = document.getElementById("settings-prompt-name");
            if (settingsPromptNameEl) settingsPromptNameEl.textContent = currentPrompt.name;
          }
        });
        ipcRenderer.on("set-current-prompt-name", (_, name) => {
          const settingsPromptNameEl = document.getElementById("settings-prompt-name");
          if (settingsPromptNameEl) settingsPromptNameEl.textContent = name;
        });
        ipcRenderer.on("set-models", (_, models, currentModel) => {
          const select = document.getElementById("model-select");
          select.innerHTML = "";
          models.forEach(model => {
            const option = document.createElement("option");
            option.value = model;
            option.textContent = model;
            option.selected = model === currentModel;
            select.appendChild(option);
          });
        });
        ipcRenderer.on("set-hotkey", (_, hotkey) => {
          const input = document.getElementById("hotkey-input");
          if (input) input.value = hotkey;
        });
        // メニューバーから呼び出されるため、IPCイベントのみ待機
        ipcRenderer.on("open-settings", () => {
          document.getElementById("settings-modal").style.display = "block";
          ipcRenderer.send("get-system-prompt");
          ipcRenderer.send("get-saved-prompts");
          ipcRenderer.send("get-models");
          ipcRenderer.send("get-hotkey");
        });
        document.getElementById("model-select").addEventListener("change", (e) => {
          ipcRenderer.send("select-model", e.target.value);
        });
        document.getElementById("close-settings-btn").addEventListener("click", () => {
          document.getElementById("settings-modal").style.display = "none";
        });
        document.getElementById("prompt-select").addEventListener("change", (e) => {
          ipcRenderer.send("select-prompt", e.target.value);
        });
        const bottomPromptSelect = document.getElementById("bottom-prompt-select");
        if (bottomPromptSelect) {
          bottomPromptSelect.addEventListener("change", (e) => {
            ipcRenderer.send("select-prompt", e.target.value);
          });
        }
        document.getElementById("save-prompt-btn").addEventListener("click", () => {
          const prompt = document.getElementById("system-prompt-input").value;
          const name = document.getElementById("prompt-name-input").value.trim();
          ipcRenderer.send("save-system-prompt", prompt, name);
          document.getElementById("prompt-name-input").value = "";
        });
        document.getElementById("delete-prompt-btn").addEventListener("click", () => {
          const select = document.getElementById("prompt-select");
          const selectedId = select.value;
          if (selectedId && selectedId !== "default") {
            if (confirm("このプロンプトを削除しますか？")) {
              ipcRenderer.send("delete-prompt", selectedId);
            }
          }
        });
        document.getElementById("reset-prompt-btn").addEventListener("click", () => {
          ipcRenderer.send("reset-system-prompt");
        });

        document.getElementById("settings-modal").addEventListener("click", (e) => {
          if (e.target.id === "settings-modal") {
            document.getElementById("settings-modal").style.display = "none";
          }
        });
        document.getElementById("settings-btn").addEventListener("click", () => {
          document.getElementById("settings-modal").style.display = "block";
          ipcRenderer.send("get-system-prompt");
          ipcRenderer.send("get-saved-prompts");
          ipcRenderer.send("get-models");
          ipcRenderer.send("get-hotkey");
        });
        // ショートカットキー入力欄のイベント
        const hotkeyInput = document.getElementById("hotkey-input");
        if (hotkeyInput) {
          let isCapturing = false;
          hotkeyInput.addEventListener("focus", () => {
            isCapturing = true;
            hotkeyInput.value = "キーを押してください...";
            hotkeyInput.style.borderColor = "rgba(100,150,255,.8)";
          });
          hotkeyInput.addEventListener("blur", () => {
            isCapturing = false;
            hotkeyInput.style.borderColor = "rgba(255,255,255,.2)";
          });
          hotkeyInput.addEventListener("keydown", (e) => {
            if (!isCapturing) return;
            e.preventDefault();
            e.stopPropagation();
            const parts = [];
            if (e.metaKey) parts.push("Cmd");
            if (e.ctrlKey) parts.push("Ctrl");
            // macOSではAltキーはOptionキーとして扱う
            if (e.altKey) {
              const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 || 
                            (typeof process !== 'undefined' && process.platform === 'darwin');
              parts.push(isMac ? "Option" : "Alt");
            }
            if (e.shiftKey) parts.push("Shift");
            if (e.key && e.key.length === 1 && /[A-Za-z0-9]/.test(e.key)) {
              parts.push(e.key.toUpperCase());
            } else if (e.key === " ") {
              parts.push("Space");
            } else if (e.key.startsWith("Arrow")) {
              parts.push(e.key.replace("Arrow", ""));
            } else if (e.key === "Enter") {
              parts.push("Enter");
            } else if (e.key === "Tab") {
              parts.push("Tab");
            } else if (e.key === "Escape") {
              parts.push("Escape");
            } else if (e.key === "Backspace") {
              parts.push("Backspace");
            } else if (e.key === "Delete") {
              parts.push("Delete");
            } else if (e.key === "Home") {
              parts.push("Home");
            } else if (e.key === "End") {
              parts.push("End");
            } else if (e.key === "PageUp") {
              parts.push("PageUp");
            } else if (e.key === "PageDown") {
              parts.push("PageDown");
            } else if (e.key === "F1" || e.key.match(/^F[0-9]+$/)) {
              parts.push(e.key);
            } else {
              return; // 認識できないキーは無視
            }
            if (parts.length === 0) return;
            const hotkeyStr = parts.join("+");
            hotkeyInput.value = hotkeyStr;
            ipcRenderer.send("set-hotkey", hotkeyStr);
            hotkeyInput.blur();
          });
        }
        document.getElementById("copy-btn").addEventListener("click", () => {
          ipcRenderer.send("copy-to-clipboard");
        });
        // hideボタンでコントロールを右に収納/展開
        let isControlsHidden = false;
        const controls = document.getElementById("bottom-right-controls");
        const hideBtn = document.getElementById("hide-controls-btn");
        hideBtn.addEventListener("click", () => {
          isControlsHidden = !isControlsHidden;
          if (isControlsHidden) {
            controls.style.opacity = "0";
            controls.style.pointerEvents = "none";
            controls.style.maxWidth = "0";
            hideBtn.textContent = "‹";
            hideBtn.title = "展開";
          } else {
            controls.style.opacity = "1";
            controls.style.pointerEvents = "auto";
            controls.style.maxWidth = "500px";
            hideBtn.textContent = "›";
            hideBtn.title = "収納";
          }
        });
      </script>
    </body></html>
  `)}`);
}

// Ollamaのモデルリストを取得
async function getOllamaModels() {
    try {
        const response = await ollama.list();
        return response.models.map(m => m.name);
    } catch (error) {
        console.error("[getOllamaModels] error:", error);
        return [];
    }
}

async function translateWithOllama(text) {
    const body = {
        model: selectedModel,
        stream: false,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Translate to Japanese:\n---\n${text}\n---` }
        ]
    };

    const response = await ollama.chat(body);
    const translatedText = response.message.content.trim();
    console.log(translatedText);
    return translatedText;
}

// AppleScriptでCopyコマンドを実行してクリップボードから選択テキストを取得
async function getSelectionViaClipboard() {
    return new Promise((resolve, reject) => {
        // クリップボードの現在の内容を保存
        const oldClipboard = clipboard.readText();
        
        // クリップボードをクリア（Copyコマンドの結果を検出するため）
        const marker = `__SELECTION_MARKER_${Date.now()}__`;
        clipboard.writeText(marker);
        
        // AppleScriptでCopyコマンドを実行
        const script = `
            tell application "System Events"
                set activeApp to name of first process whose frontmost is true
                tell process activeApp
                    set frontmost to true
                    try
                        click menu item "Copy" of menu "Edit" of menu bar 1
                    on error
                        try
                            -- 日本語環境の場合
                            click menu item "コピー" of menu "編集" of menu bar 1
                        on error
                            -- キーボードショートカットでCopyを実行
                            keystroke "c" using command down
                        end try
                    end try
                end tell
            end tell
        `;
        
        exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (error) => {
            if (error) {
                // エラーでもクリップボードを復元
                setTimeout(() => {
                    clipboard.writeText(oldClipboard);
                }, 100);
                reject(new Error("Copyコマンドの実行に失敗しました"));
                return;
            }
            
            // クリップボードの内容を取得（少し待機してから）
            setTimeout(() => {
                let clipboardContents = clipboard.readText();
                let attempts = 0;
                
                // マーカーが残っている場合は、Copyが完了するまで待機
                const checkClipboard = () => {
                    clipboardContents = clipboard.readText();
                    if (clipboardContents === marker && attempts < 10) {
                        attempts++;
                        setTimeout(checkClipboard, 100);
                    } else if (clipboardContents === marker) {
                        // タイムアウト：元のクリップボードを復元
                        clipboard.writeText(oldClipboard);
                        reject(new Error("選択テキストの取得に失敗しました（タイムアウト）"));
                    } else {
                        // 成功：選択テキストを保存してから元のクリップボードを復元
                        const selectedText = clipboardContents;
                        clipboard.writeText(oldClipboard);
                        
                        if (selectedText && selectedText.trim() && selectedText !== oldClipboard) {
                            resolve(selectedText.trim());
                        } else {
                            reject(new Error("テキストが選択されていません"));
                        }
                    }
                };
                
                checkClipboard();
            }, 200);
        });
    });
}

async function copySelectedFresh() {
    // まず直接取得を試す
    try {
        const selectedText = getSelectedText();
        console.log("[getSelectedText] 直接取得成功");
        if (selectedText && selectedText.trim()) {
            return selectedText.trim();
        }
    } catch (error) {
        console.log("[getSelectedText] 直接取得失敗、クリップボード経由を試行:", error.message);
    }
    
    // フォールバック：クリップボード経由で取得
    try {
        const selectedText = await getSelectionViaClipboard();
        console.log("[getSelectionViaClipboard] クリップボード経由で取得成功");
        return selectedText;
    } catch (error) {
        console.error("[getSelectionViaClipboard] error:", error);
        throw new Error("テキストが選択されていません");
    }
}

// アクティブな仮想デスクトップ（スペース）のカーソル位置を取得
function getActiveDisplayPosition() {
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);

    // カーソル位置をディスプレイの座標系に変換
    const x = cursorPoint.x + 12;
    const y = cursorPoint.y + 12;

    return { x, y, display };
}

function showNearCursor(text) {
    // 翻訳結果を保存（コピー機能用）
    if (text && text !== "翻訳中…" && !text.startsWith("テキストが選択されていません") && !text.includes("Error")) {
        currentTranslatedText = text;
    }

    const isVisible = win.isVisible();

    if (isVisible) {
        // 既に表示されている場合は、位置を変えずにテキストだけを更新
        win.webContents.send("set-text", text || "(no output)");
        return;
    }

    // 非表示の場合は、カーソル位置に表示
    const { x, y, display } = getActiveDisplayPosition();

    // 現在のデスクトップに表示するために、一度非表示にしてから再設定
    // これにより、ウィンドウが作成されたデスクトップではなく、現在のデスクトップに表示される
    win.hide();

    // すべてのスペースに表示できるように設定（表示時に再設定）
    // macOSで現在のデスクトップに表示するために重要
    try {
        // Electron 28以降では第2引数にオプションを渡せる
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch (e) {
        // 古いバージョンの場合は第1引数のみ
        win.setVisibleOnAllWorkspaces(true);
    }

    // ウィンドウをアクティブなディスプレイに表示
    win.setPosition(x, y, false);
    win.webContents.send("set-text", text || "(no output)");
    
    // 少し待ってから表示することで、現在のデスクトップに確実に表示される
    // macOSでは、非表示→設定→位置変更→表示の順序が重要
    setTimeout(() => {
        win.showInactive(); // フォーカス奪わない
    }, 10);
}

app.whenReady().then(() => {
    // 起動時にsavedPromptsが空の場合はデフォルトを追加
    const savedPrompts = store.get('savedPrompts', []);
    if (savedPrompts.length === 0) {
        store.set('savedPrompts', [
            { id: 'default', name: 'デフォルト', prompt: defaultPrompt }
        ]);
    }

    console.log("[system-prompt] 読み込み:", systemPrompt);

    createWin();

    // 起動時に右下のプロンプトセレクトボックスを初期化
    setTimeout(() => {
        if (win && !win.isDestroyed()) {
            const savedPrompts = store.get('savedPrompts', []);
            const currentPromptId = store.get('currentPromptId', 'default');
            win.webContents.send("set-saved-prompts", savedPrompts, currentPromptId);
        }
    }, 500);

    // ウィンドウを閉じるIPCハンドラー
    ipcMain.on("close-window", () => {
        if (win) {
            win.hide();
        }
    });

    // クリップボードにコピーするIPCハンドラー
    ipcMain.on("copy-to-clipboard", () => {
        if (currentTranslatedText) {
            clipboard.writeText(currentTranslatedText);
            // フィードバックのために一時的にテキストを変更
            win.webContents.send("set-text", "✓ クリップボードにコピーしました\n\n" + currentTranslatedText);
            setTimeout(() => {
                win.webContents.send("set-text", currentTranslatedText);
            }, 1000);
        }
    });

    // 設定を開くIPCハンドラー（メニューバーから呼び出し）
    ipcMain.on("open-settings", () => {
        if (win) {
            win.webContents.send("open-settings");
        }
    });

    // System Prompt関連のIPCハンドラー
    ipcMain.on("get-system-prompt", () => {
        win.webContents.send("set-system-prompt", systemPrompt);
    });

    // モデル関連のIPCハンドラー
    ipcMain.on("get-models", async () => {
        const models = await getOllamaModels();
        win.webContents.send("set-models", models, selectedModel);
    });

    ipcMain.on("select-model", (event, model) => {
        selectedModel = model;
        store.set('selectedModel', model);
        console.log("[model] 選択:", model);
    });

    ipcMain.on("get-saved-prompts", () => {
        const savedPrompts = store.get('savedPrompts', []);
        const currentPromptId = store.get('currentPromptId', 'default');
        win.webContents.send("set-saved-prompts", savedPrompts, currentPromptId);
        // 現在のプロンプト名を送信
        const currentPrompt = savedPrompts.find(p => p.id === currentPromptId);
        if (currentPrompt) {
            win.webContents.send("set-current-prompt-name", currentPrompt.name);
        }
    });

    ipcMain.on("select-prompt", (event, promptId) => {
        const savedPrompts = store.get('savedPrompts', []);
        const selectedPrompt = savedPrompts.find(p => p.id === promptId);
        if (selectedPrompt) {
            systemPrompt = selectedPrompt.prompt;
            store.set('systemPrompt', systemPrompt);
            store.set('currentPromptId', promptId);
            win.webContents.send("set-system-prompt", systemPrompt);
            win.webContents.send("set-current-prompt-name", selectedPrompt.name);
            console.log("[system-prompt] 選択:", selectedPrompt.name);
        }
    });

    ipcMain.on("save-system-prompt", (event, prompt, name) => {
        if (!prompt || !prompt.trim()) {
            return;
        }

        const savedPrompts = store.get('savedPrompts', []);
        let promptId;
        let promptName;

        if (name && name.trim()) {
            // 新規保存
            promptId = `prompt_${Date.now()}`;
            promptName = name.trim();
            savedPrompts.push({ id: promptId, name: promptName, prompt: prompt.trim() });
        } else {
            // 現在選択中のpromptを更新
            const currentPromptId = store.get('currentPromptId', 'default');
            const existingIndex = savedPrompts.findIndex(p => p.id === currentPromptId);
            if (existingIndex >= 0) {
                savedPrompts[existingIndex].prompt = prompt.trim();
                promptId = currentPromptId;
                promptName = savedPrompts[existingIndex].name;
            } else {
                // 新規保存（名前なし）
                promptId = `prompt_${Date.now()}`;
                promptName = `プロンプト ${savedPrompts.length}`;
                savedPrompts.push({ id: promptId, name: promptName, prompt: prompt.trim() });
            }
        }

        store.set('savedPrompts', savedPrompts);
        systemPrompt = prompt.trim();
        store.set('systemPrompt', systemPrompt);
        store.set('currentPromptId', promptId);

        win.webContents.send("set-saved-prompts", savedPrompts, promptId);
        win.webContents.send("set-system-prompt", systemPrompt);
        win.webContents.send("set-current-prompt-name", promptName);
        console.log("[system-prompt] 保存:", promptName);
    });

    ipcMain.on("delete-prompt", (event, promptId) => {
        if (promptId === 'default') {
            return; // デフォルトは削除不可
        }

        const savedPrompts = store.get('savedPrompts', []);
        const filteredPrompts = savedPrompts.filter(p => p.id !== promptId);
        
        if (filteredPrompts.length === 0) {
            // すべて削除された場合はデフォルトを追加
            filteredPrompts.push({ id: 'default', name: 'デフォルト', prompt: defaultPrompt });
        }

        store.set('savedPrompts', filteredPrompts);

        // 削除されたpromptが現在選択中の場合、デフォルトに切り替え
        const currentPromptId = store.get('currentPromptId', 'default');
        if (currentPromptId === promptId) {
            const defaultPromptObj = filteredPrompts.find(p => p.id === 'default') || filteredPrompts[0];
            systemPrompt = defaultPromptObj.prompt;
            store.set('systemPrompt', systemPrompt);
            store.set('currentPromptId', defaultPromptObj.id);
            win.webContents.send("set-system-prompt", systemPrompt);
            win.webContents.send("set-current-prompt-name", defaultPromptObj.name);
        } else {
            // 削除されなかった場合も現在のプロンプト名を更新
            const currentPrompt = filteredPrompts.find(p => p.id === currentPromptId);
            if (currentPrompt) {
                win.webContents.send("set-current-prompt-name", currentPrompt.name);
            }
        }

        win.webContents.send("set-saved-prompts", filteredPrompts, store.get('currentPromptId', 'default'));
        console.log("[system-prompt] 削除:", promptId);
    });

    ipcMain.on("reset-system-prompt", () => {
        systemPrompt = defaultPrompt;
        store.set('systemPrompt', systemPrompt);
        store.set('currentPromptId', 'default');
        win.webContents.send("set-system-prompt", systemPrompt);
        win.webContents.send("set-saved-prompts", store.get('savedPrompts', []), 'default');
        win.webContents.send("set-current-prompt-name", 'デフォルト');
        console.log("[system-prompt] リセット:", systemPrompt);
    });

    // ショートカットキー関連のIPCハンドラー
    ipcMain.on("get-hotkey", () => {
        win.webContents.send("set-hotkey", currentHotkey);
    });

    ipcMain.on("set-hotkey", (event, hotkey) => {
        if (!hotkey || !hotkey.trim()) {
            return;
        }
        registerHotkey(hotkey.trim());
    });

    // ショートカットキーを登録する関数
    function registerHotkey(hotkey) {
        // 既存のショートカットを解除（保存値から登録値に変換）
        if (currentHotkey) {
            let unregisterKey = currentHotkey;
            if (process.platform === 'darwin') {
                unregisterKey = currentHotkey.replace(/Option\+/gi, 'Alt+');
            }
            if (globalShortcut.isRegistered(unregisterKey)) {
                globalShortcut.unregister(unregisterKey);
                console.log("[hotkey] 解除:", unregisterKey, "(保存値:", currentHotkey, ")");
            }
        }

        // macOSの場合はOptionをAltに変換（globalShortcutはAltを期待）
        // 大文字小文字を区別せずに変換
        let normalizedHotkey = hotkey;
        if (process.platform === 'darwin') {
            normalizedHotkey = hotkey.replace(/Option\+/gi, 'Alt+');
        }

        // 新しいショートカットを登録（エラーハンドリング付き）
        let ok = false;
        try {
            ok = globalShortcut.register(normalizedHotkey, async () => {
                const now = Date.now();
                const isDouble = (now - lastCmdCAt) < 350; // ここは好みで調整
                lastCmdCAt = now;

                if (!isDouble) return; // 1回目は何もしない（DeepLっぽさ）

                showNearCursor("Querying...");

                try {
                    const t = await copySelectedFresh(); // 下の関数
                    if (!t || !t.trim()) {
                        showNearCursor("テキストが選択されていません");
                        return;
                    }
                    const out = await translateWithOllama(t.trim());
                    showNearCursor(out);
                } catch (e) {
                    showNearCursor(String(e));
                }
            });
        } catch (error) {
            console.error("[hotkey] 登録エラー:", error);
            ok = false;
        }

        if (ok) {
            currentHotkey = hotkey;
            store.set('hotkey', hotkey);
            console.log("[hotkey] 登録成功:", normalizedHotkey, "(保存値:", hotkey, ")");
            console.log("[hotkey] isRegistered =", globalShortcut.isRegistered(normalizedHotkey));
        } else {
            console.error("[hotkey] 登録失敗:", normalizedHotkey);
            // 登録に失敗した場合は、エラーメッセージを表示してデフォルトに戻す
            if (win && !win.isDestroyed()) {
                win.webContents.send("set-text", `ショートカットキーの登録に失敗しました: ${hotkey}\nデフォルトに戻します。`);
            }
            const defaultHotkey = 'Alt+Z';
            if (hotkey !== defaultHotkey) {
                setTimeout(() => {
                    registerHotkey(defaultHotkey);
                    if (win && !win.isDestroyed()) {
                        win.webContents.send("set-hotkey", defaultHotkey);
                    }
                }, 1000);
            }
        }
    }

    // 起動時に保存されたショートカットキーを確認し、Option+Zの場合はAlt+Zに統一
    if (currentHotkey === 'Option+Z') {
        currentHotkey = 'Alt+Z';
        store.set('hotkey', 'Alt+Z');
    }
    
    // 起動時に保存されたショートカットキーを登録
    registerHotkey(currentHotkey);
});

// すべてのウィンドウが閉じられてもアプリを終了させない（macOSの場合）
app.on('window-all-closed', (event) => {
    // macOSでは、すべてのウィンドウが閉じられてもアプリを終了させない
    // これにより、×ボタンでウィンドウを閉じてもプロセスは動き続ける
    if (process.platform !== 'darwin') {
        app.quit();
    }
});