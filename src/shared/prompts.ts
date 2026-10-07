import type { Prompt } from './ipc'

/** 組込みプリセットの初期値。編集は可能だが、削除不可・「初期値に戻す」で復元できる */
export const BUILTIN_PROMPTS: Prompt[] = [
  {
    id: 'translate',
    name: '翻訳（日本語へ）',
    system:
      'You are a professional translator. Output ONLY the translation. Keep formatting. ' +
      'If the text is already Japanese, translate it into English.',
    userTemplate: 'Translate to Japanese:\n---\n{{text}}\n---',
    builtin: true
  },
  {
    id: 'summarize',
    name: '要約',
    system: '与えられたテキストを日本語で簡潔に要約する。要点を箇条書きにする。余計な前置きは書かない。',
    userTemplate: '{{text}}',
    builtin: true
  },
  {
    id: 'explain-code',
    name: 'コード説明',
    system: '与えられたコードや技術テキストが何をするものかを、日本語で簡潔に説明する。',
    userTemplate: '{{text}}',
    builtin: true
  }
]
