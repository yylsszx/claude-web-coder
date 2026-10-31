'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { useTheme } from 'next-themes'
import { EditorView, keymap } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
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
  Keyboard,
  Minus,
  Pencil,
  PencilLine,
  Plus,
  Redo2,
  Undo2,
  Save,
  Search,
  Sparkles,
  SquarePen,
  WrapText,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { AiMessage } from '@/components/workspace/ai-message'
import type { FileFull, FileMeta } from '@/lib/types'

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

/** 状态栏光标信息 */
interface CursorInfo {
  line: number
  col: number
  selLines: number
  selChars: number
  totalChars: number
}

/** 每个标签的记忆快照：光标选区（doc 偏移）+ 滚动位置，切换标签时恢复 */
interface TabEditorState {
  anchor: number
  head: number
  top: number
}

type MdViewMode = 'edit' | 'split' | 'preview'

const MD_VIEW_OPTIONS: { value: MdViewMode; label: string; icon: typeof Pencil }[] = [
  { value: 'edit', label: '编辑', icon: Pencil },
  { value: 'split', label: '分屏', icon: Columns2 },
  { value: 'preview', label: '预览', icon: BookOpen },
]

/**
 * 编辑器显示偏好（自动换行 / 字号）作为外部存储（localStorage）：
 * SSR 快照返回默认值，客户端读取缓存值，避免 hydration 不一致与 effect 内 setState
 */
interface EditorPrefs {
  wrap: boolean
  font: number
}
const DEFAULT_PREFS: EditorPrefs = { wrap: false, font: 13.5 }
let prefsCache: EditorPrefs | null = null
const prefsListeners = new Set<() => void>()

function readEditorPrefs(): EditorPrefs {
  if (prefsCache) return prefsCache
  let next = DEFAULT_PREFS
  try {
    const font = Number(localStorage.getItem('cw-editor-font'))
    next = {
      wrap: localStorage.getItem('cw-editor-wrap') === '1',
      font: Number.isFinite(font) && font >= 11 && font <= 18 ? font : DEFAULT_PREFS.font,
    }
  } catch {
    /* 存储不可用时用默认值 */
  }
  prefsCache = next
  return next
}

function writeEditorPrefs(patch: Partial<EditorPrefs>) {
  const next = { ...readEditorPrefs(), ...patch }
  prefsCache = next
  try {
    localStorage.setItem('cw-editor-wrap', next.wrap ? '1' : '0')
    localStorage.setItem('cw-editor-font', String(next.font))
  } catch {
    /* 存储不可用时仅内存生效 */
  }
  prefsListeners.forEach((l) => l())
}

function useEditorPrefs(): EditorPrefs {
  return useSyncExternalStore(
    (cb) => {
      prefsListeners.add(cb)
      return () => {
        prefsListeners.delete(cb)
      }
    },
    readEditorPrefs,
    () => DEFAULT_PREFS
  )
}

interface CodeEditorProps {
  tabs: FileFull[]
  activeId: string | null
  tabStates: Record<string, SaveState>
  onSwitchTab: (id: string) => void
  onCloseTab: (id: string) => void
  /** 右键菜单：关闭其他标签（保留指定标签） */
  onCloseOtherTabs: (id: string) => void
  /** 右键菜单：关闭指定标签右侧的所有标签 */
  onCloseRightTabs: (id: string) => void
  /** 右键菜单：关闭全部标签 */
  onCloseAllTabs: () => void
  /** 拖拽排序：把 fromId 标签移动到 toId 位置 */
  onReorderTabs: (fromId: string, toId: string) => void
  onChange: (value: string) => void
  onSave: () => void
  /** 当前未保存标签总数（含当前标签），> 1 时工具栏显示「全部保存」 */
  dirtyCount?: number
  /** 一键保存全部未保存文件（Ctrl/⌘ + Alt + S） */
  onSaveAll?: () => void
  jumpTarget?: JumpTarget | null
  /** 选中文本后请求 AI 处理 */
  onAskSelection?: (action: SelectionAction, sel: SelectionPayload) => void
  /** AI 正在生成时禁用选区快捷操作 */
  askDisabled?: boolean
  /** 注册「插入到光标位置」函数（供 AI 代码块调用） */
  registerInsert?: (fn: (text: string) => void) => void
  /** 注册「读取当前选区」函数（供命令面板「让 AI 解释选中代码」调用；无选区时返回 null） */
  registerSelectionGetter?: (fn: () => SelectionPayload | null) => void
  /** 最近更新的文件（空态快捷入口，最多展示 5 个） */
  recentFiles?: FileMeta[]
  /** 空态点击最近文件直接打开 */
  onOpenFile?: (id: string) => void
  /** 空态快速打开（Ctrl/⌘ + P） */
  onQuickOpen?: () => void
  /** 空态全局搜索（Ctrl/⌘ + Shift + F） */
  onGlobalSearch?: () => void
}

export function CodeEditor({
  tabs,
  activeId,
  tabStates,
  onSwitchTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseRightTabs,
  onCloseAllTabs,
  onReorderTabs,
  onChange,
  onSave,
  dirtyCount = 0,
  onSaveAll,
  jumpTarget,
  onAskSelection,
  askDisabled,
  registerInsert,
  registerSelectionGetter,
  recentFiles,
  onOpenFile,
  onQuickOpen,
  onGlobalSearch,
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme()
  const editorViewRef = useRef<EditorView | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const tabStripRef = useRef<HTMLDivElement | null>(null)
  const [selState, setSelState] = useState<SelState | null>(null)
  const [mdView, setMdView] = useState<MdViewMode>('edit')
  const [cursorInfo, setCursorInfo] = useState<CursorInfo | null>(null)
  // 标签切换记忆：光标选区 + 滚动位置（会话级内存，关闭后重开同文件仍可恢复）
  const tabStatesRef = useRef(new Map<string, TabEditorState>())
  // 撤销 / 重做可用性（undoDepth/redoDepth 驱动按钮禁用态）
  const [histState, setHistState] = useState({ undo: 0, redo: 0 })
  // 当前文件 id 的 ref（handleUpdate / onScrollCapture 闭包中读取，避免陈旧闭包）
  const fileIdRef = useRef<string | null>(null)
  // 标签页拖拽排序：拖拽中的标签 id（ref 供事件逻辑同步读取）+ 悬停目标（高亮反馈）
  const dragTabIdRef = useRef<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  // 编辑器显示偏好：自动换行 / 字号（localStorage 外部存储，刷新后保持；SSR 快照给默认值避免 hydration 不一致）
  const prefs = useEditorPrefs()
  const toggleWrap = useCallback(() => {
    writeEditorPrefs({ wrap: !readEditorPrefs().wrap })
  }, [])
  const changeFontSize = useCallback((delta: number) => {
    const cur = readEditorPrefs().font
    writeEditorPrefs({ font: Math.min(18, Math.max(11, Math.round((cur + delta) * 2) / 2)) })
  }, [])

  // 标签栏竖向滚轮转为横向滚动（标签过多时无需按住 Shift；仅在溢出时劫持，其余交给原生）
  useEffect(() => {
    const el = tabStripRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.deltaY || e.ctrlKey || e.metaKey) return
      if (el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [tabs.length])

  const file = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? null,
    [tabs, activeId]
  )
  // 同步当前文件 id 到 ref（渲染期禁止写 ref，改在 effect 中更新；事件回调中读取避免陈旧闭包）
  useEffect(() => {
    fileIdRef.current = file?.id ?? null
  }, [file?.id])

  // Ctrl/⌘ + 滚轮调节编辑器字号（非 passive 监听以拦截浏览器页面缩放；与 A−/A+ 同一偏好持久化）
  // 依赖 file?.id 且置于 file 声明之后：contentRef 只在打开文件后渲染，需在首个文件打开后重新绑定
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      e.stopPropagation()
      changeFontSize(e.deltaY < 0 ? 0.5 : -0.5)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [changeFontSize, file?.id])

  /** 把当前视图的选区并入指定文件的快照（滚动位置另行记录） */
  const rememberSelection = useCallback((fileId: string, view: EditorView) => {
    const sel = view.state.selection.main
    const prev = tabStatesRef.current.get(fileId)
    if (prev) {
      prev.anchor = sel.anchor
      prev.head = sel.head
    } else {
      tabStatesRef.current.set(fileId, {
        anchor: sel.anchor,
        head: sel.head,
        top: view.scrollDOM.scrollTop,
      })
    }
  }, [])

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

  // 从当前视图同步状态栏光标信息
  const syncCursor = useCallback((view: EditorView) => {
    const sel = view.state.selection.main
    const line = view.state.doc.lineAt(sel.head)
    const next: CursorInfo = {
      line: line.number,
      col: sel.head - line.from + 1,
      // 行数按选区两端所在行计算（与光标方向无关）
      selLines: sel.empty ? 0 : view.state.doc.lineAt(sel.to).number - view.state.doc.lineAt(sel.from).number + 1,
      selChars: sel.empty ? 0 : sel.to - sel.from,
      totalChars: view.state.doc.length,
    }
    setCursorInfo((prev) =>
      prev &&
      prev.line === next.line &&
      prev.col === next.col &&
      prev.selLines === next.selLines &&
      prev.selChars === next.selChars &&
      prev.totalChars === next.totalChars
        ? prev
        : next
    )
  }, [])

  // 跟踪编辑器选区：非空选区时记录文本、行号与浮动工具条坐标；同步撤销/重做可用性与标签记忆
  const handleUpdate = useCallback(
    (vu: ViewUpdate) => {
      if (!vu.selectionSet && !vu.docChanged) return
      const view = vu.view
      syncCursor(view)
      // 记录光标选区到当前文件的快照（切换标签后恢复）
      if (fileIdRef.current) rememberSelection(fileIdRef.current, view)
      // 同步撤销 / 重做按钮禁用态
      const uDepth = undoDepth(vu.state)
      const rDepth = redoDepth(vu.state)
      setHistState((prev) =>
        prev.undo === uDepth && prev.redo === rDepth ? prev : { undo: uDepth, redo: rDepth }
      )
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
    },
    [syncCursor, rememberSelection]
  )

  /** 撤销 / 重做：预览模式下视图已卸载，静默忽略 */
  const runHistory = useCallback((kind: 'undo' | 'redo') => {
    const view = editorViewRef.current
    if (!view) return
    try {
      if (kind === 'undo') undo(view)
      else redo(view)
      view.focus()
    } catch {
      /* 视图已销毁时忽略 */
    }
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

  /** 在当前光标后插入文本并滚动可见 */
  const insertAtCursor = useCallback((text: string) => {
    const view = editorViewRef.current
    if (!view) return
    try {
      const pos = view.state.selection.main.to
      view.dispatch({
        changes: { from: pos, insert: text },
        selection: { anchor: pos + text.length },
        effects: EditorView.scrollIntoView(pos + text.length, { y: 'nearest' }),
      })
      view.focus()
    } catch {
      /* 视图已销毁（如预览模式卸载）时忽略 */
    }
  }, [])

  // 注册「插入到光标位置」：Markdown 预览模式下先切回编辑模式再插入
  const mdViewRef = useRef(mdView)
  useEffect(() => {
    mdViewRef.current = mdView
  }, [mdView])
  useEffect(() => {
    if (!registerInsert) return
    registerInsert((text: string) => {
      if (mdViewRef.current === 'preview') {
        setMdView('edit')
        requestAnimationFrame(() => insertAtCursor(text))
        return
      }
      insertAtCursor(text)
    })
  }, [registerInsert, insertAtCursor])

  // 注册「读取当前选区」：命令面板打开导致编辑器失焦时浮动工具条会被隐藏，
  // 故从 ref 读最后记录的非空选区（selState 隐藏后置 null，ref 保留），供 askAboutSelection 使用；
  // 切换标签 / 文件时旧选区立即作废，避免把旧文件的代码算到新文件头上
  const lastSelRef = useRef<SelectionPayload | null>(null)
  const lastSelFileRef = useRef<string | null>(null)
  useEffect(() => {
    const fid = file?.id ?? null
    if (lastSelFileRef.current !== fid) {
      lastSelFileRef.current = fid
      lastSelRef.current = null
      return // 切文件后的第一次 effect 里 selState 仍是旧文件的残留，直接作废
    }
    if (!file || !selState) return
    lastSelRef.current = {
      text: selState.text,
      path: file.path,
      language: file.language,
      fromLine: selState.fromLine,
      toLine: selState.toLine,
    }
  }, [selState, file])
  useEffect(() => {
    if (!registerSelectionGetter) return
    registerSelectionGetter(() => lastSelRef.current)
  }, [registerSelectionGetter])

  const language = file?.language
  const wrapText = prefs.wrap
  const fontSize = prefs.font
  const extensions = useMemo<Extension[]>(() => {
    const base: Extension[] = [search(), keymap.of(searchKeymap)]
    if (wrapText) base.push(EditorView.lineWrapping)
    if (!language) return base
    const factory = LANGUAGE_EXTENSIONS[language]
    return factory ? [factory(), ...base] : base
  }, [language, wrapText])

  if (!file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
          <FileCode2 className="h-7 w-7 text-clay" />
        </div>
        <div>
          <p className="font-claude-serif text-base font-medium text-foreground/70">
            选择或新建一个文件开始编码
          </p>
          <p className="mx-auto mt-1.5 max-w-[300px] text-xs text-muted-foreground">
            支持多标签页编辑、语法高亮与自动保存；选中代码可让 AI 解释、优化或修复
          </p>
        </div>
        {recentFiles && recentFiles.length > 0 && (
          <div className="flex flex-col items-center gap-1">
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/70">
              最近更新
            </p>
            {recentFiles.slice(0, 5).map((f) => (
              <button
                key={f.id}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] text-foreground/80 transition-colors hover:bg-accent hover:text-clay"
                onClick={() => onOpenFile?.(f.id)}
                title={`打开 ${f.path}`}
              >
                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="font-mono">{f.path}</span>
              </button>
            ))}
          </div>
        )}
        {(onQuickOpen || onGlobalSearch) && (
          <div className="flex items-center gap-2">
            {onQuickOpen && (
              <Button variant="secondary" size="sm" className="h-7 gap-1.5 px-3 text-xs" onClick={onQuickOpen}>
                <Search className="h-3 w-3" />
                快速打开
                <span className="text-[10px] text-muted-foreground">⌘P</span>
              </Button>
            )}
            {onGlobalSearch && (
              <Button variant="secondary" size="sm" className="h-7 gap-1.5 px-3 text-xs" onClick={onGlobalSearch}>
                <Keyboard className="h-3 w-3" />
                全局搜索
                <span className="text-[10px] text-muted-foreground">⌘⇧F</span>
              </Button>
            )}
          </div>
        )}
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
        <div ref={tabStripRef} className="thin-scrollbar flex h-9 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border bg-secondary/50 px-1.5 pt-1.5">
          {tabs.map((tab, idx) => {
            const isActive = tab.id === activeId
            const isDirty = (tabStates[tab.id] ?? 'saved') !== 'saved'
            const isLast = idx === tabs.length - 1
            return (
              <ContextMenu key={tab.id}>
                <ContextMenuTrigger asChild>
                  <div
                    draggable
                    onDragStart={(e) => {
                      dragTabIdRef.current = tab.id
                      setDraggingId(tab.id)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', tab.id)
                    }}
                    onDragOver={(e) => {
                      if (!dragTabIdRef.current || dragTabIdRef.current === tab.id) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      if (dropTargetId !== tab.id) setDropTargetId(tab.id)
                    }}
                    onDragLeave={() => {
                      if (dropTargetId === tab.id) setDropTargetId(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      const from = dragTabIdRef.current
                      dragTabIdRef.current = null
                      setDraggingId(null)
                      setDropTargetId(null)
                      if (from && from !== tab.id) onReorderTabs(from, tab.id)
                    }}
                    onDragEnd={() => {
                      dragTabIdRef.current = null
                      setDraggingId(null)
                      setDropTargetId(null)
                    }}
                    onMouseDown={(e) => {
                      // 中键点击关闭标签（与 × 一致，走脏保存链路）；阻止浏览器自动滚动
                      if (e.button === 1) {
                        e.preventDefault()
                        onCloseTab(tab.id)
                      }
                    }}
                    className={`group/tab flex min-w-[110px] max-w-[180px] shrink-0 cursor-grab items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 text-[12.5px] transition-colors ${
                      isActive
                        ? 'border-border bg-card font-medium text-foreground'
                        : 'border-transparent text-muted-foreground hover:bg-card/60'
                    } ${draggingId === tab.id ? 'opacity-40' : ''} ${
                      dropTargetId === tab.id && draggingId && draggingId !== tab.id
                        ? 'ring-1 ring-inset ring-clay/60'
                        : ''
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
                </ContextMenuTrigger>
                <ContextMenuContent className="w-44">
                  <ContextMenuItem
                    disabled={tabs.length <= 1}
                    onSelect={() => onCloseOtherTabs(tab.id)}
                  >
                    关闭其他标签
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={isLast}
                    onSelect={() => onCloseRightTabs(tab.id)}
                  >
                    关闭右侧标签
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={tabs.length === 0}
                    className="text-destructive focus:text-destructive"
                    onSelect={() => onCloseAllTabs()}
                  >
                    关闭全部标签
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
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
        {/* 撤销 / 重做（undoDepth/redoDepth 驱动禁用态） */}
        <div className="ml-1 flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-secondary/60 p-0.5">
          <button
            type="button"
            onClick={() => runHistory('undo')}
            disabled={histState.undo === 0}
            title="撤销（Ctrl/⌘ + Z）"
            aria-label="撤销"
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Undo2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => runHistory('redo')}
            disabled={histState.redo === 0}
            title="重做（Ctrl/⌘ + Shift + Z）"
            aria-label="重做"
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Redo2 className="h-3 w-3" />
          </button>
        </div>
        {/* 显示偏好：字号调节 + 自动换行开关 */}
        <div className="ml-1 flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-secondary/60 p-0.5">
          <button
            type="button"
            onClick={() => changeFontSize(-0.5)}
            disabled={fontSize <= 11}
            title="减小字号（也可 Ctrl/⌘ + 滚轮）"
            aria-label="减小字号"
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Minus className="h-3 w-3" />
          </button>
          <span
            className="w-10 shrink-0 text-center text-[10.5px] tabular-nums text-muted-foreground"
            title="编辑器字号"
          >
            {fontSize}px
          </span>
          <button
            type="button"
            onClick={() => changeFontSize(0.5)}
            disabled={fontSize >= 18}
            title="增大字号（也可 Ctrl/⌘ + 滚轮）"
            aria-label="增大字号"
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />
          </button>
          <span className="mx-0.5 h-3.5 w-px shrink-0 bg-border" />
          <button
            type="button"
            onClick={toggleWrap}
            title={wrapText ? '关闭自动换行' : '开启自动换行（长行折行显示）'}
            aria-label="切换自动换行"
            aria-pressed={wrapText}
            className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
              wrapText
                ? 'bg-card text-clay shadow-sm'
                : 'text-muted-foreground hover:bg-card hover:text-foreground'
            }`}
          >
            <WrapText className="h-3 w-3" />
          </button>
        </div>
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
        {dirtyCount > 1 && (
          <Button
            size="sm"
            variant="secondary"
            className="h-7 gap-1 px-2.5 text-xs text-clay hover:text-clay"
            onClick={onSaveAll}
            title={`保存全部 ${dirtyCount} 个未保存文件（Ctrl/⌘ + Alt + S）`}
          >
            <Save className="h-3 w-3" />
            全部保存（{dirtyCount}）
          </Button>
        )}
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
            style={{ '--cm-font-size': `${fontSize}px` } as CSSProperties}
            onScrollCapture={(e) => {
              // CodeMirror 滚动容器滚动时记录滚动位置到当前文件快照（切换标签后恢复视口）
              const el = e.target as HTMLElement
              const fid = fileIdRef.current
              if (!fid || !el.classList?.contains('cm-scroller')) return
              const prev = tabStatesRef.current.get(fid)
              if (prev) prev.top = el.scrollTop
              else {
                const view = editorViewRef.current
                const sel = view?.state.selection.main
                tabStatesRef.current.set(fid, {
                  anchor: sel?.anchor ?? 0,
                  head: sel?.head ?? 0,
                  top: el.scrollTop,
                })
              }
            }}
          >
            <CodeMirror
              key={file.id}
              value={file.content}
              height="100%"
              style={{ height: '100%' }}
              theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
              extensions={extensions}
              onChange={onChange}
              onUpdate={handleUpdate}
              onCreateEditor={(view) => {
                editorViewRef.current = view
                syncCursor(view)
                // 恢复该文件上次的光标与滚动位置（doc 可能已变化，位置夹到文档末尾）
                const saved = tabStatesRef.current.get(file.id)
                if (saved) {
                  const len = view.state.doc.length
                  try {
                    view.dispatch({
                      selection: EditorSelection.range(
                        Math.min(saved.anchor, len),
                        Math.min(saved.head, len)
                      ),
                    })
                  } catch {
                    /* 选区无效时忽略 */
                  }
                  requestAnimationFrame(() => {
                    try {
                      view.scrollDOM.scrollTop = saved.top
                    } catch {
                      /* 视图已销毁时忽略 */
                    }
                  })
                  if (fileIdRef.current) rememberSelection(fileIdRef.current, view)
                }
                const uDepth = undoDepth(view.state)
                const rDepth = redoDepth(view.state)
                setHistState((prev) =>
                  prev.undo === uDepth && prev.redo === rDepth
                    ? prev
                    : { undo: uDepth, redo: rDepth }
                )
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

      {/* 状态栏：光标位置 / 选区统计 / 字符数 */}
      {cursorInfo && (
        <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-secondary/40 px-3 text-[11px] text-muted-foreground">
          {showEditor && (
            <span>
              行 {cursorInfo.line}，列 {cursorInfo.col}
            </span>
          )}
          {showEditor && cursorInfo.selChars > 0 && (
            <span className="text-clay">
              已选 {cursorInfo.selLines > 1 ? `${cursorInfo.selLines} 行 / ` : ''}
              {cursorInfo.selChars} 字符
            </span>
          )}
          <span className="ml-auto">
            共 {cursorInfo.totalChars.toLocaleString()} 字符
          </span>
        </div>
      )}

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
