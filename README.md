# Quick Query

選択したテキストを **Cmd+C+C**（Cmd+C を素早く2回）でローカル LLM（[Ollama](https://ollama.com)）に送り、結果をカーソル付近のポップアップにストリーミング表示する macOS メニューバーアプリ。翻訳・要約・コード説明などは、プロンプトの切替で使い分けます。

- 通常のコピーは邪魔しません（キー入力は listen-only で監視）。
- 選択の取得は OS のコピー結果（クリップボード）を使うため、クリップボードの退避・書き換えはしません。
- 通信先はローカルの Ollama のみです。選択テキストと結果は保存しません。

## 必要なもの

- macOS、Node.js 22 以上（`.nvmrc` あり。20.19 未満だと `npm run dist` が ERR_REQUIRE_ESM で失敗する）、Xcode Command Line Tools（`swiftc`）
- Ollama が起動していて、モデルを取得済み（例: `ollama pull gemma3`）

## 開発

```bash
npm install
npm run dev      # キー監視ヘルパー(Swift)をビルドして起動
npm test         # ユニットテスト
npm run typecheck
```

初回は **システム設定 › プライバシーとセキュリティ › 入力監視** で、開発中は Electron（またはターミナル）、配布版は Quick Query を許可してください。許可すると自動で有効になります。メニューバーのアイコンから状態を確認できます。

`QQ_DEBUG=1 npm run dev` で処理の段階ログ（本文は出しません）を表示します。

## 使い方

1. テキストを選択する
2. **Cmd+C+C**
3. ポップアップに結果が流れる。`Esc` で閉じる／生成を中断、「コピー」で結果をコピー

メニューバーから、プロンプトの切替・一時停止・設定を操作できます。設定では、モデル、Ollama ホスト、二度押し間隔、入力の最大文字数、プロンプトの作成・複製・削除を行えます。組込みプロンプト（翻訳／要約／コード説明）は複製して編集します。

## 配布ビルド

```bash
npm run dist     # .dmg を dist/ に生成
```

署名・公証には Apple Developer ID が必要です（未署名でも動きますが、Gatekeeper の許可操作が要ります）。

## 構成

`docs/requirements.md`（要件）、`docs/design.md`（設計）を参照。

```
native/keywatch.swift   Cmd+C と pasteboard 変更の検知 (CGEventTap listen-only)
src/main/               トリガー判定、Ollama、ウィンドウ、設定、トレイ
src/preload, shared     型付き IPC
src/renderer            popup / settings
```
