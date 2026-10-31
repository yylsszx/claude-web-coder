'use client'

import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { json } from '@codemirror/lang-json'
import { sql } from '@codemirror/lang-sql'
import type { Extension } from '@codemirror/state'
import { Check, CloudUpload, FileCode2, PencilLine, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { FileFull } from '@/lib/types'

const LANGUAGE_EXTENSIONS: Record<string, () => Extension> = {
  javascript: () => javascript({ jsx: true }),
  typescript: () => javascript({ jsx: true, typescript: true }),
  python: () => python(),
  html: () => html(),
  css: () => css(),
  markdown: () => markdown(),
  json: () => json(),
  sql: () => sql(),
}

const LANGUAGE_LABELS: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  html: 'HTML',
  css: 'CSS',
  markdown: 'Markdown',
  json: 'JSON',
  sql: 'SQL',
  plaintext: '纯文本',
}

export type SaveState = 'saved' | 'dirty' | 'saving'

interface CodeEditorProps {
  tabs: FileFull[]
  activeId: string | null
  tabStates: Record<string, SaveState>
  onSwitchTab: (id: string) => void
  onCloseTab: (id: string) => void
  onChange: (value: string) => void
  onSave: () => void
}

export function CodeEditor({
  tabs,
  activeId,
  tabStates,
  onSwitchTab,
  onCloseTab,
  onChange,
  onSave,
}: CodeEditorProps) {
  const file = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? null,
    [tabs, activeId]
  )

  const language = file?.language
  const extensions = useMemo<Extension[]>(() => {
    if (!language) return []
    const factory = LANGUAGE_EXTENSIONS[language]
    return factory ? [factory()] : []
  }, [language])

  if (!file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
          <FileCode2 className="h-7 w-7 text-clay" />
        </div>
        <p className="font-claude-serif text-base font-medium text-foreground/70">
          选择或新建一个文件开始编码
        </p>
        <p className="max-w-[260px] text-xs text-muted-foreground">
          支持多标签页编辑、语法高亮与自动保存；右侧 AI 助手可帮你生成、解释和优化代码
        </p>
      </div>
    )
  }

  const saveState = tabStates[file.id] ?? 'saved'
  const saveIndicator = {
    saved: { icon: Check, text: '已保存' },
    dirty: { icon: PencilLine, text: '未保存' },
    saving: { icon: CloudUpload, text: '保存中…' },
  }[saveState]
  const SaveIcon = saveIndicator.icon

  return (
    <div className="flex h-full flex-col">
      {/* 标签栏 */}
      {tabs.length > 0 && (
        <div className="thin-scrollbar flex h-9 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border bg-secondary/50 px-1.5 pt-1.5">
          {tabs.map((tab) => {
            const isActive = tab.id === activeId
            const isDirty = (tabStates[tab.id] ?? 'saved') !== 'saved'
            return (
              <div
                key={tab.id}
                className={`group/tab flex min-w-[110px] max-w-[180px] shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 text-[12.5px] transition-colors ${
                  isActive
                    ? 'border-border bg-card font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-card/60'
                }`}
              >
                <button
                  className="min-w-0 flex-1 truncate py-1.5 text-left"
                  onClick={() => onSwitchTab(tab.id)}
                  title={tab.path}
                >
                  {tab.path.split('/').pop()}
                </button>
                {isDirty && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-clay" title="未保存" />
                )}
                <button
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-accent group-hover/tab:opacity-100 focus:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTab(tab.id)
                  }}
                  aria-label={`关闭 ${tab.path}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* 编辑器工具栏 */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2.5">
        <span className="truncate font-mono text-[13px] text-foreground/85">{file.path}</span>
        <Badge variant="secondary" className="shrink-0 text-[11px]">
          {LANGUAGE_LABELS[file.language] ?? file.language}
        </Badge>
        <span
          className={`ml-auto flex shrink-0 items-center gap-1 text-[11px] ${
            saveState === 'dirty' ? 'text-clay' : 'text-muted-foreground'
          }`}
        >
          <SaveIcon className={`h-3 w-3 ${saveState === 'saving' ? 'animate-pulse' : ''}`} />
          {saveIndicator.text}
        </span>
        <Button
          size="sm"
          className="h-7 px-3 text-xs"
          onClick={onSave}
          disabled={saveState === 'saving' || saveState === 'saved'}
        >
          保存
        </Button>
      </div>

      {/* CodeMirror 编辑器（key 保证切换标签时干净重挂载） */}
      <div className="thin-scrollbar min-h-0 flex-1 overflow-auto bg-card">
        <CodeMirror
          key={file.id}
          value={file.content}
          height="100%"
          style={{ height: '100%' }}
          theme="light"
          extensions={extensions}
          onChange={onChange}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLine: true,
            foldGutter: true,
            bracketMatching: true,
            autocompletion: true,
            highlightSelectionMatches: true,
          }}
        />
      </div>
    </div>
  )
}
