'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { json } from '@codemirror/lang-json'
import { sql } from '@codemirror/lang-sql'
import type { Extension } from '@codemirror/state'
import {
  BookOpen,
  Check,
  CloudUpload,
  Columns2,
  FileCode2,
  Pencil,
  PencilLine,
  Sparkles,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AiMessage } from '@/components/workspace/ai-message'
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

/** 跳转到指定文件的指定行（nonce 变化触发跳转） */
export interface JumpTarget {
  fileId: string
  line: number
  nonce: number
}

/** 编辑器选中文本后可触发的 AI 快捷操作 */
export type SelectionAction = 'explain' | 'optimize' | 'fix'

/** 选中文本的上下文（发送给 AI） */
export interface SelectionPayload {
  text: string
  path: string
  language: string
  fromLine: number
  toLine: number
}

/** 选区浮动工具条的定位信息 */
interface SelState {
  from: number
  to: number
  text: string
  fromLine: number
  toLine: number
  x: number
  yTop: number
  yBottom: number
}

type MdViewMode = 'edit' | 'split' | 'preview'

const MD_VIEW_OPTIONS: { value: MdViewMode; label: string; icon: typeof Pencil }[] = [
  { value: 'edit', label: '编辑', icon: Pencil },
  { value: 'split', label: '分屏', icon: Columns2 },
  { value: 'preview', label: '预览', icon: BookOpen },
]

interface CodeEditorProps {
  tabs: FileFull[]
  activeId: string | null
  tabStates: Record<string, SaveState>
  onSwitchTab: (id: string) => void
  onCloseTab: (id: string) => void
  onChange: (value: string) => void
  onSave: () => void
  jumpTarget?: JumpTarget | null
  /** 选中文本后请求 AI 处理 */
  onAskSelection?: (action: SelectionAction, sel: SelectionPayload) => void
  /** AI 正在生成时禁用选区快捷操作 */
  askDisabled?: boolean
}

export function CodeEditor({
  tabs,
  activeId,
  tabStates,
  onSwitchTab,
  onCloseTab,
  onChange,
  onSave,
  jumpTarget,
  onAskSelection,
  askDisabled,
}: CodeEditorProps) {
  const editorViewRef = useRef<EditorView | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [selState, setSelState] = useState<SelState | null>(null)
  const [mdView, setMdView] = useState<MdViewMode>('edit')

  const file = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? null,
    [tabs, activeId]
  )

  // 切换文件时重置选区工具条与 Markdown 视图（渲染期状态调整，避免 effect 级联渲染）
  const [lastFileId, setLastFileId] = useState<string | null>(file?.id ?? null)
  if ((file?.id ?? null) !== lastFileId) {
    setLastFileId(file?.id ?? null)
    setSelState(null)
    setMdView('edit')
  }

  // 跳转到指定行（全局搜索命中后调用）：光标定位 + 居中滚动 + 焦点
  useEffect(() => {
    if (!jumpTarget || !file || file.id !== jumpTarget.fileId) return
    const view = editorViewRef.current
    if (!view) return
    const lineNo = Math.min(Math.max(1, jumpTarget.line), view.state.doc.lines)
    const lineInfo = view.state.doc.line(lineNo)
    view.dispatch({
      selection: EditorSelection.cursor(lineInfo.from),
      effects: EditorView.scrollIntoView(lineInfo.from, { y: 'center' }),
    })
    view.focus()
  }, [jumpTarget, file])

  // 点击编辑器与工具条之外的区域时隐藏浮动工具条
  useEffect(() => {
    if (!selState) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (toolbarRef.current?.contains(target)) return
      if (contentRef.current?.contains(target)) return
      setSelState(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [selState])

  // 跟踪编辑器选区：非空选区时记录文本、行号与浮动工具条坐标
  const handleUpdate = useCallback((vu: ViewUpdate) => {
    if (!vu.selectionSet && !vu.docChanged) return
    const view = vu.view
    const range = view.state.selection.main
    if (range.empty) {
      setSelState((prev) => (prev ? null : prev))
      return
    }
    const text = view.state.sliceDoc(range.from, range.to)
    if (!text.trim()) {
      setSelState((prev) => (prev ? null : prev))
      return
    }
    const coords = view.coordsAtPos(range.head)
    if (!coords) return
    const next: SelState = {
      from: range.from,
      to: range.to,
      text,
      fromLine: view.state.doc.lineAt(range.from).number,
      toLine: view.state.doc.lineAt(range.to).number,
      x: coords.left,
      yTop: coords.top,
      yBottom: coords.bottom,
    }
    setSelState((prev) => {
      if (
        prev &&
        prev.from === next.from &&
        prev.to === next.to &&
        Math.abs(prev.x - next.x) < 1 &&
        Math.abs(prev.yTop - next.yTop) < 1
      ) {
        return prev
      }
      return next
    })
  }, [])

  const askSelection = useCallback(
    (action: SelectionAction) => {
      if (!selState || !file || !onAskSelection || askDisabled) return
      onAskSelection(action, {
        text: selState.text,
        path: file.path,
        language: file.language,
        fromLine: selState.fromLine,
        toLine: selState.toLine,
      })
      setSelState(null)
    },
    [selState, file, onAskSelection, askDisabled]
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
          支持多标签页编辑、语法高亮与自动保存；选中代码可让 AI 解释、优化或修复
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

  const isMd = file.language === 'markdown'
  const showEditor = !isMd || mdView !== 'preview'
  const showPreview = isMd && mdView !== 'edit'

  // 浮动工具条定位：优先显示在选区上方，空间不足时放下方，并限制在视口内
  const toolbarLeft = Math.min(Math.max(selState?.x ?? 0, 8), window.innerWidth - 300)
  const toolbarTop =
    selState && selState.yTop > 100 ? selState.yTop - 42 : (selState?.yBottom ?? 0) + 8

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
        {isMd && (
          <div className="flex shrink-0 items-center rounded-md border border-border bg-secondary/60 p-0.5">
            {MD_VIEW_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setMdView(value)}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                  mdView === value
                    ? 'bg-card font-medium text-clay shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title={`${label}模式`}
              >
                <Icon className="h-3 w-3" />
                <span className="hidden md:inline">{label}</span>
              </button>
            ))}
          </div>
        )}
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

      {/* 编辑 / 预览区域 */}
      <div
        ref={contentRef}
        className="flex min-h-0 flex-1"
        onScrollCapture={() => setSelState((prev) => (prev ? null : prev))}
      >
        {showEditor && (
          <div
            className={`thin-scrollbar min-w-0 bg-card ${
              showPreview ? 'flex-1 overflow-hidden' : 'h-full flex-1 overflow-auto'
            }`}
          >
            <CodeMirror
              key={file.id}
              value={file.content}
              height="100%"
              style={{ height: '100%' }}
              theme="light"
              extensions={extensions}
              onChange={onChange}
              onUpdate={handleUpdate}
              onCreateEditor={(view) => {
                editorViewRef.current = view
              }}
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
        )}

        {showPreview && (
          <>
            <div className="w-px shrink-0 bg-border" />
            <div className="thin-scrollbar min-w-0 flex-1 overflow-auto bg-card">
              <div className="markdown-preview mx-auto max-w-3xl px-6 py-5">
                <AiMessage content={file.content} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* 选中文本浮动 AI 工具条 */}
      {selState && (
        <div
          ref={toolbarRef}
          className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-lg"
          style={{ left: toolbarLeft, top: toolbarTop }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Sparkles className="mx-1 h-3 w-3 shrink-0 text-clay" />
          {(
            [
              { action: 'explain', label: '解释' },
              { action: 'optimize', label: '优化' },
              { action: 'fix', label: '修复' },
            ] as const
          ).map(({ action, label }) => (
            <button
              key={action}
              className="rounded-md px-2 py-1 text-[11.5px] text-foreground/80 transition-colors hover:bg-accent hover:text-clay disabled:cursor-not-allowed disabled:opacity-50"
              disabled={askDisabled}
              onClick={() => askSelection(action)}
              title={`让 AI ${label}选中代码（第 ${selState.fromLine}${
                selState.toLine !== selState.fromLine ? `-${selState.toLine}` : ''
              } 行）`}
            >
              {label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px shrink-0 bg-border" />
          <span className="whitespace-nowrap px-0.5 text-[10.5px] text-muted-foreground">
            L{selState.fromLine}
            {selState.toLine !== selState.fromLine ? `-${selState.toLine}` : ''}
          </span>
          <button
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
            onClick={() => setSelState(null)}
            aria-label="关闭选区工具条"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}
