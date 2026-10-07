# Quick-Query 設計書（ゼロから再設計）

- 版数: 0.2（実装反映: キー監視は Swift ヘルパー `native/keywatch.swift` を採用。`uiohook-napi` は不使用）
- 前提: `docs/requirements.md` v0.2。現行 `cmd.js` には依存しない（流用もしない）。

## 1. 設計方針

1. **Cmd+C+C は「コピーを奪わない」**。OS が行う通常のコピーを邪魔せず、2回目の Cmd+C を検知したときだけ動く。
2. **選択取得はクリップボードだけ**。Cmd+C が OS のコピーを行うので、アプリ側から AppleScript でキーを送ったり、クリップボードを退避・復元したりしない。
3. **フォーカスを奪わない**。ポップアップは非アクティブ表示。
4. **最初のトークンを最速で出す**。ストリーミング描画。
5. **セキュリティ既定値を守る**。`contextIsolation: true`、`nodeIntegration: false`、preload 経由の最小 IPC。
6. **ローカル完結**。通信先は Ollama（既定 `127.0.0.1:11434`）のみ。

## 2. 技術選定

| 領域 | 採用 | 理由 |
|---|---|---|
| ランタイム | Electron（現行安定版）+ TypeScript | 全デスクトップ表示・非アクティブウィンドウ・トレイが素直に使える |
| ビルド | electron-vite | main / preload / renderer を一括ビルド |
| UI | Svelte（またはバニラ TS） | ポップアップは小さく軽量にしたい。React は過剰 |
| キー監視 | `uiohook-napi` | 受動的なグローバルキー監視。プリビルド済みで Electron に載せやすい |
| LLM | `ollama` JS クライアント（`stream: true`、`AbortController`） | 公式。中断可能 |
| 設定保存 | `electron-store` + zod で検証 | 壊れた設定を起動時に復旧 |
| テスト | Vitest（ロジック層）、Playwright for Electron（E2E 最小限） | |

### キー監視の代替案

| 案 | 長所 | 短所 |
|---|---|---|
| A. `uiohook-napi`（不採用） | 追加バイナリ不要、JS だけで完結 | 「入力監視」権限が必要。クリップボード変更の有無は判定できない |
| B. Swift 製ヘルパー（CGEventTap listen-only）を子プロセス化（**採用**） | `NSPasteboard.changeCount` で「コピーが起きたか」を正確に判定できる | Swift ビルド・同梱・署名が増える |
| C. `globalShortcut` で Cmd+C を登録 | 簡単 | 通常のコピーを奪うため不可 |

TBD-A（古いクリップボード）を正確に検出するため B を採用した。ヘルパーは Cmd+C 押下と、その後 `NSPasteboard.changeCount` が変わったかを JSON Lines で報告する。Esc などの他キーもヘルパー経由で受けるため、`globalShortcut` で Esc を奪わない。キー監視は `KeyTrigger` インターフェースの裏に隠して入れ替え可能にする。

## 3. アーキテクチャ

```
┌───────────────────────── Main process ─────────────────────────┐
│ TriggerService ──▶ Orchestrator ──▶ LlmService (Ollama stream)  │
│  (uiohook)           │  ▲                                        │
│                      │  └── SettingsStore (zod, electron-store)  │
│                      ▼                                           │
│               WindowManager ── PopupWindow / SettingsWindow       │
│               TrayService / PermissionService / AutoLaunch        │
└──────────────────────────┬──────────────────────────────────────┘
                   preload (contextBridge, 型付き IPC)
┌──────────────────────────┴──────────────────────────────────────┐
│ Renderer: popup（結果表示）/ settings（設定）/ onboarding         │
└─────────────────────────────────────────────────────────────────┘
```

### ディレクトリ

```
src/
  main/
    index.ts              起動、シングルインスタンス、ライフサイクル
    trigger/              KeyTrigger.ts, DoubleCopyDetector.ts(純ロジック)
    orchestrator.ts       1回の問い合わせの状態機械
    llm/ollama.ts         stream / abort / list / health
    clipboard.ts          選択テキストの読み取りと検証
    windows/popup.ts      位置計算、非アクティブ表示
    windows/settings.ts
    tray.ts, permissions.ts, autolaunch.ts
    settings/schema.ts    zod スキーマ、既定値、マイグレーション
  preload/index.ts        公開 API の定義
  renderer/{popup,settings,onboarding}/
  shared/ipc.ts           IPC のチャンネル名と型
tests/
```

`DoubleCopyDetector` は時刻とキーイベントだけを受ける純関数的クラスにして、Electron に依存させない（ユニットテスト対象）。

## 4. 主要フロー: Cmd+C+C

```
keydown(C, meta=true)  ──▶ DoubleCopyDetector.onCopyKey(t)
   1回目: t0 を記録して終了（OS は通常どおりコピー）
   2回目: t - t0 <= threshold(既定400ms) かつ 間に他のキー入力なし
           └─▶ emit "double-copy"

Orchestrator.onDoubleCopy():
  1. 進行中のリクエストがあれば abort
  2. 約60ms待つ（アプリのコピー完了を待つ）
  3. text = clipboard.readText()
  4. 空 → エラー表示 "選択がありません"
  5. 上限超過 → 切り詰めて警告
  6. PopupWindow をカーソル付近に非アクティブ表示（スピナー）
  7. LlmService.stream(prompt, text) → トークンごとに popup へ送信
  8. 完了 / 中断 / エラーで状態を確定
```

### 検知ルール（DoubleCopyDetector）

- 対象: `keycode=C` かつ Meta（左右どちらでも）が押下中。長押しのキーリピートは無視（`keydown` の連続は 1 回とみなす）。
- 2回押しの間に C 以外のキーが押されたらリセット。
- 3回押しは 2回目で発火済みなので、発火後は 600ms のクールダウンで連打を無視。
- 発火しても **OS へのキー伝達は止めない**（listen-only）。

### 状態機械（Orchestrator）

`idle → capturing → streaming → done`、どの状態からも `error` / `cancelled` へ遷移でき、新しいトリガーは常に `cancelled → capturing` へ。

## 5. 重要な設計判断

### 5.1 プロンプトモデル

```ts
type Prompt = {
  id: string;
  name: string;
  system: string;
  userTemplate: string; // 例: "{{text}}" / "Translate to Japanese:\n---\n{{text}}\n---"
  builtin: boolean;
  model?: string;       // 任意。未指定ならグローバルのモデル
};
```

固定指示は持たず、`userTemplate` の `{{text}}` を置換するだけ。組込みは「翻訳（日本語へ）」「要約」「コード説明」の 3 つで、削除不可・複製して編集可。

### 5.2 ポップアップ

- `BrowserWindow`: `frame: false`、`alwaysOnTop: 'screen-saver'`、`focusable: false`、`skipTaskbar`、`show: false` で生成し、表示は `showInactive()`。
- `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`。
- 位置: `screen.getCursorScreenPoint()` を基準に、カーソルのあるディスプレイの `workArea` 内に収まるよう補正（右・下にはみ出す場合は反転）。
- 表示中の再トリガーは位置を維持したまま内容だけ入れ替える。
- Esc で閉じるには一時的にフォーカスが要る。`focusable: false` のままでは Esc を受けられないため、**ポップアップ上のクリックで初めてフォーカス可能にする**（`setFocusable(true)`）。キー操作で閉じたい場合はグローバルの Esc 監視（表示中のみ）を使う。
- 描画は Markdown を安全にレンダリング（HTML 無効化）。

### 5.3 古いクリップボード問題（TBD-A）

Cmd+C 時に選択が無いとコピーは起きず、クリップボードは古い内容のまま。uiohook 案では検出できない。方針案:

- v1: 古い内容でも「直近コピーしたテキスト」として扱う（Cmd+C+C の意味は「コピーしたものを聞く」）。ポップアップ冒頭に、送ったテキストの先頭 40 文字を薄く表示し、意図しない内容に気付けるようにする。
- 将来: Swift ヘルパー（案B）で `changeCount` が変わらなければ「選択がありません」を表示。

### 5.4 ストリーミングとキャンセル

- `ollama.chat({ stream: true })` の `AsyncIterable` をメインで消費し、`webContents.send('llm:token', chunk)` で送る。バッチ化（16ms）して IPC 回数を抑える。
- `AbortController` を `Orchestrator` が保持。新規トリガー、Esc、ポップアップを閉じる操作で `abort()`。Ollama 側の生成も止める（`ollama.abort()`）。
- 接続エラーは `ECONNREFUSED` → 「Ollama が起動していません」、`model not found` → 「モデルが未取得です: `ollama pull <model>`」に分類。

### 5.5 権限とオンボーディング

| 権限 | 用途 | 確認方法 | 案内 |
|---|---|---|---|
| 入力監視 | グローバルキー監視 | 起動時に監視開始を試み、イベントが来るかで判定。`systemPreferences` で直接は取れない | システム設定の該当ペインを開くボタン |
| アクセシビリティ | uiohook の環境で必要になる場合あり | `systemPreferences.isTrustedAccessibilityClient(false)` | 同上 |
| Ollama 接続 | 推論 | `ollama.list()` の疎通 | 起動手順・`ollama pull` の例を表示 |

初回起動はオンボーディング画面で 3 項目のチェックを順に通す。未許可のままでもトレイは常駐し、トリガー時に不足項目をポップアップで案内する。

### 5.6 設定スキーマ

```ts
type Settings = {
  version: 1;
  model: string;                 // 既定は ollama list の先頭。未設定なら初回に選ばせる
  ollamaHost: string;            // 既定 http://127.0.0.1:11434
  currentPromptId: string;
  prompts: Prompt[];
  trigger: { doubleCopyMs: number; enabled: boolean; altHotkey?: string };
  maxInputChars: number;         // 既定 8000
  launchAtLogin: boolean;
};
```

起動時に zod で検証し、失敗したフィールドだけ既定値へ戻す。`version` でマイグレーション。

### 5.7 セキュリティ

- すべてのウィンドウで `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。レンダラは `file://` の同梱 HTML のみ。外部 URL のナビゲーションは `will-navigate` で拒否。
- IPC は `shared/ipc.ts` に列挙したチャンネルだけを preload が公開。引数は main 側で zod 検証。
- LLM 出力は Markdown としてサニタイズして描画。
- 選択テキストと出力は永続化しない。ログにも本文を出さない（長さと所要時間のみ）。デバッグ時だけ環境変数で解除。

## 6. UI 概要

- **ポップアップ**（幅 360〜520px、最大高さは画面の 60%）: ヘッダー（プロンプト選択、コピー、閉じる）、本文（ストリーム描画）、フッター（モデル名・所要時間）。エラー時は原因と対処ボタン。
- **設定**: 一般（モデル、ホスト、起動時開始、トリガー）、プロンプト（一覧と編集）、権限状況。
- **トレイ**: 設定、一時停止/再開、Ollama 状態、終了。

## 7. テスト方針

| 対象 | 方法 |
|---|---|
| DoubleCopyDetector | Vitest。400ms 境界、キーリピート、他キー割り込み、クールダウン |
| プロンプト展開、設定スキーマ・マイグレーション | Vitest |
| Orchestrator | Ollama とクリップボードをモックし、状態遷移・中断・エラー分類を検証 |
| ポップアップ位置計算 | 複数ディスプレイ・端のケースを純関数で検証 |
| E2E | Playwright for Electron で、擬似的な `double-copy` イベント注入 → 表示まで |
| 手動 | 権限付与、フルスクリーンアプリ上の表示、各種アプリ（ブラウザ、エディタ、PDF、ターミナル）でのコピー |

## 8. マイルストーン

| MS | 内容 | 完了条件 |
|---|---|---|
| M1 | プロジェクト雛形、DoubleCopyDetector、クリップボード読み取り、最小ポップアップ | Cmd+C+C でコピー文字列が表示される |
| M2 | Ollama ストリーミング、中断、エラー分類 | 翻訳がトークンごとに流れ、Esc で止まる |
| M3 | 設定・プロンプト管理・モデル選択 | 再起動後も設定が残る |
| M4 | トレイ常駐、オンボーディング、自動起動 | 初回起動から権限付与まで案内で完結 |
| M5 | 署名・公証、配布、README 刷新 | `.dmg` から導入できる |

## 9. 現行実装から持ち越さないもの

- ホットキーを `globalShortcut` で奪う方式、AppleScript によるキー送出、クリップボードの退避・復元
- `data:` URL に埋め込んだ巨大 HTML、`nodeIntegration: true` / `contextIsolation: false`
- ユーザー発話の固定文字列、非ストリーム応答
- ×ボタンを `hide` に差し替えるだけの常駐方式（トレイに置き換え）
- `Cmd+Q` の無効化と `process.exit(0)` による強制終了（トレイの「終了」で正規終了）

## 10. 未解決事項

- TBD-A（古いクリップボード）、TBD-B（Developer ID）、TBD-C（入力長上限）。
- ポップアップで Esc を受ける方法（§5.2）は、`focusable: false` と両立しないため実機で検証して確定する。
- `uiohook-napi` が使用する Electron バージョンで動作するか、M1 の最初に確認する。
