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
import type { Command, ViewUpdate } from '@codemirror/view'
import { EditorSelection, Prec } from '@codemirror/state'
import { cursorMatchingBracket, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { foldAll, unfoldAll } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { json } from '@codemirror/lang-json'
import { sql } from '@codemirror/lang-sql'
import { indentationMarkers } from '@replit/codemirror-indentation-markers'
import type { Extension } from '@codemirror/state'
import {
  Bold,
  BookOpen,
  Braces,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  CloudUpload,
  Code,
  Columns2,
  Copy,
  Download,
  FileCode2,
  Heading2,
  History,
  Italic,
  Keyboard,
  Link2,
  Minus,
  MoreHorizontal,
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
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { copyTextToClipboard } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AiMessage } from '@/components/workspace/ai-message'
import { HtmlPreviewFrame } from '@/components/workspace/html-preview'
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

/** 复制当前行 / 选区（Ctrl/⌘ + D）：副本插到原处下方，光标随行移动、选区随文本选中 */
const duplicateSelection: Command = (view) => {
  const { state } = view
  const range = state.selection.main
  if (!range.empty) {
    // 有选区：复制选中文本插入到选区之后，并选中副本便于直接编辑
    const text = state.sliceDoc(range.from, range.to)
    view.dispatch({
      changes: { from: range.to, insert: text },
      selection: EditorSelection.range(range.to, range.to + text.length),
    })
    return true
  }
  // 无选区：复制整行（在行尾补换行 + 行文本，首末行同样成立），光标落到新行同列
  const line = state.doc.lineAt(range.head)
  const col = range.head - line.from
  view.dispatch({
    changes: { from: line.to, insert: '\n' + line.text },
    selection: EditorSelection.cursor(line.to + 1 + Math.min(col, line.text.length)),
  })
  return true
}

/** 上移当前行 / 选区覆盖的行块（Alt + ↑）：与上一行整体交换，选区随行平移 */
const moveLinesUp: Command = (view) => {
  const { state } = view
  const range = state.selection.main
  const fromLine = state.doc.lineAt(range.from)
  const toLine = state.doc.lineAt(range.to)
  if (fromLine.number <= 1) return true // 已在首行，无上一行可换
  const prevLine = state.doc.line(fromLine.number - 1)
  const block = state.sliceDoc(fromLine.from, toLine.to)
  const prevText = state.sliceDoc(prevLine.from, prevLine.to)
  view.dispatch({
    changes: { from: prevLine.from, to: toLine.to, insert: block + '\n' + prevText },
    selection: EditorSelection.range(
      prevLine.from + (range.from - fromLine.from),
      prevLine.from + (range.to - fromLine.from)
    ),
  })
  return true
}

/** 下移当前行 / 选区覆盖的行块（Alt + ↓）：与下一行整体交换，选区随行平移 */
const moveLinesDown: Command = (view) => {
  const { state } = view
  const range = state.selection.main
  const fromLine = state.doc.lineAt(range.from)
  const toLine = state.doc.lineAt(range.to)
  if (toLine.number >= state.doc.lines) return true // 已在末行，无下一行可换
  const nextLine = state.doc.line(toLine.number + 1)
  const block = state.sliceDoc(fromLine.from, toLine.to)
  const nextText = state.sliceDoc(nextLine.from, nextLine.to)
  // 下移后行块的新起点 = 原起点 + 下一行文本长度 + 换行符
  const blockNewFrom = fromLine.from + nextText.length + 1
  view.dispatch({
    changes: { from: fromLine.from, to: nextLine.to, insert: nextText + '\n' + block },
    selection: EditorSelection.range(
      blockNewFrom + (range.from - fromLine.from),
      blockNewFrom + (range.to - fromLine.from)
    ),
  })
  return true
}

/** 删除当前行 / 选区覆盖的行块（Ctrl/⌘ + Shift + K）：整行连同换行符删除，可撤销 */
const deleteLines: Command = (view) => {
  const { state } = view
  const range = state.selection.main
  const fromLine = state.doc.lineAt(range.from)
  const toLine = state.doc.lineAt(range.to)
  if (toLine.number === state.doc.lines) {
    // 末行没有尾随换行符：连同行前的换行符一起删，避免上方残留空行
    const from =
      fromLine.number > 1 ? state.doc.line(fromLine.number - 1).to : fromLine.from
    view.dispatch({
      changes: { from, to: toLine.to },
      selection: EditorSelection.cursor(from),
    })
    return true
  }
  // 非末行：删到下一行开头，把行自身的换行符一并带走
  const to = Math.min(toLine.to + 1, state.doc.length)
  view.dispatch({
    changes: { from: fromLine.from, to },
    selection: EditorSelection.cursor(fromLine.from),
  })
  return true
}

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
  totalLines: number
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
  /** 注册「格式化当前 JSON 文件」函数（供命令面板调用；非 json 文件时 toast 提示） */
  registerFormatJson?: (fn: () => void) => void
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
  /** 状态栏「行，列」点击回调：打开转到行对话框（未传时渲染纯文本） */
  onOpenGoto?: () => void
  /** 打开当前文件的历史版本对话框（对话框在页面层，未打开文件也可从文件树右键进入） */
  onOpenHistory: () => void
  /** 按需拉取工作区文件内容（路径 → 内容；HTML 预览内联本地 CSS/JS 时用，null 表示不存在） */
  resolvePreviewFile?: (path: string) => Promise<string | null>
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
  registerFormatJson,
  registerSelectionGetter,
  recentFiles,
  onOpenFile,
  onQuickOpen,
  onGlobalSearch,
  onOpenGoto,
  onOpenHistory,
  resolvePreviewFile,
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme()
  const { toast } = useToast()
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
  // 已打开标签的实时内容 map（含未保存修改）：HTML 预览内联本地引用时优先取用
  // （必须在早退空态分支之前调用，避免条件 hooks）
  const openFilesMap = useMemo(
    () => Object.fromEntries(tabs.map((t) => [t.path, t.content])),
    [tabs]
  )
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
      totalLines: view.state.doc.lines,
    }
    setCursorInfo((prev) =>
      prev &&
      prev.line === next.line &&
      prev.col === next.col &&
      prev.selLines === next.selLines &&
      prev.selChars === next.selChars &&
      prev.totalChars === next.totalChars &&
      prev.totalLines === next.totalLines
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

  /** JSON 格式化（工具栏按钮仅 json 文件展示；命令面板入口任意文件可达，故在函数内守卫）：
      parse 失败 toast 报错；成功整文替换走撤销栈（Ctrl+Z 可还原） */
  const handleFormatJson = useCallback(() => {
    const view = editorViewRef.current
    if (!view || !file) return
    if (file.language !== 'json') {
      toast({ title: '当前打开的不是 JSON 文件' })
      return
    }
    const raw = view.state.doc.toString()
    if (!raw.trim()) return
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch (err) {
      toast({
        title: 'JSON 解析失败',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
      return
    }
    const formatted = JSON.stringify(data, null, 2) + '\n'
    if (formatted === raw) {
      toast({ title: '已是格式化状态，无需调整' })
      return
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: formatted },
    })
    view.focus()
    toast({
      title: '已格式化 JSON',
      description: `${raw.length.toLocaleString()} → ${formatted.length.toLocaleString()} 字符（Ctrl/⌘ + Z 可还原）`,
    })
  }, [toast, file])

  // 注册「格式化当前 JSON 文件」（命令面板入口）：经 ref 转发避免 toast/file 依赖变化反复注册
  const formatJsonRef = useRef(handleFormatJson)
  useEffect(() => {
    formatJsonRef.current = handleFormatJson
  }, [handleFormatJson])
  useEffect(() => {
    if (!registerFormatJson) return
    registerFormatJson(() => formatJsonRef.current())
  }, [registerFormatJson])

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

  // ===== Markdown 快捷格式化与复制全文 =====
  const [copiedFile, setCopiedFile] = useState(false)

  /** 在当前视图上执行编辑操作；预览模式下先切回编辑模式再执行 */
  const runOnEditorView = (fn: (view: EditorView) => void) => {
    if (mdViewRef.current === 'preview') {
      setMdView('edit')
      requestAnimationFrame(() => {
        const v = editorViewRef.current
        if (v) {
          fn(v)
          v.focus()
        }
      })
      return
    }
    const v = editorViewRef.current
    if (v) {
      fn(v)
      v.focus()
    }
  }

  /** 折叠 / 展开全部代码块（预览模式下编辑器已卸载，此时不动作）；快捷键 Ctrl/⌘ + Alt + [ / ] 由 basicSetup 的 foldKeymap 内置 */
  const foldAllLines = () => {
    const v = editorViewRef.current
    if (!v) return
    foldAll(v)
    v.focus()
  }
  const unfoldAllLines = () => {
    const v = editorViewRef.current
    if (!v) return
    unfoldAll(v)
    v.focus()
  }

  /** 包裹语法（加粗 / 斜体 / 行内代码）：有选区则包裹并保持选中，无选区插入占位文本并选中便于直接覆盖 */
  const mdWrap = (before: string, after: string, placeholder: string) =>
    runOnEditorView((view) => {
      const { from, to } = view.state.selection.main
      const sel = view.state.sliceDoc(from, to) || placeholder
      view.dispatch({
        changes: { from, to, insert: before + sel + after },
        selection: EditorSelection.range(from + before.length, from + before.length + sel.length),
      })
    })

  /** 链接：有选区作链接文字（选中 url 段待填），无选区插入模板并选中文字段 */
  const mdInsertLink = () =>
    runOnEditorView((view) => {
      const { from, to } = view.state.selection.main
      const sel = view.state.sliceDoc(from, to)
      const text = sel || '链接文字'
      const insert = `[${text}](url)`
      view.dispatch({
        changes: { from, to, insert },
        selection: sel
          ? EditorSelection.range(from + text.length + 3, from + insert.length - 1)
          : EditorSelection.range(from + 1, from + 1 + text.length),
      })
    })

  /** 标题切换：当前行无 # 则加 `## `，有则移除；光标列随前缀增减平移 */
  const mdToggleHeading = () =>
    runOnEditorView((view) => {
      const pos = view.state.selection.main.from
      const line = view.state.doc.lineAt(pos)
      const m = /^(#{1,6})\s+/.exec(line.text)
      const col = pos - line.from
      const newText = m ? line.text.replace(/^#{1,6}\s+/, '') : '## ' + line.text
      const nextCol = m ? Math.max(0, col - (m[0].length ?? 0)) : col + 3
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: newText },
        selection: EditorSelection.cursor(line.from + Math.min(nextCol, newText.length)),
      })
    })

  /** 复制当前文件全部内容 */
  const copyFileContent = async () => {
    if (!file) return
    const ok = await copyTextToClipboard(file.content)
    if (ok) {
      setCopiedFile(true)
      setTimeout(() => setCopiedFile(false), 1500)
    }
  }

  const language = file?.language
  const wrapText = prefs.wrap
  const fontSize = prefs.font
  const extensions = useMemo<Extension[]>(() => {
    // 自定义键位：Ctrl/⌘ + D 复制行/选区，Alt + ↑/↓ 上下移动行块，Ctrl/⌘ + Shift + K 删行。
    // Prec.high 使其先于 basicSetup 内置 keymap：searchKeymap 的 Mod-d 是多光标 selectNextOccurrence，
    // 不提升则 Ctrl+D 被它抢占（单光标时选中一个词并吞掉事件），复制行永远轮不到。
    // Mod-Shift-\ 匹配括号跳转：显式注册而非依赖 defaultKeymap —— Shift 与 \ 组合键在
    // 美式布局下 event.key 是 |，内置键名的匹配可能落空，双写两种键名保证生效
    const base: Extension[] = [
      search(),
      Prec.high(
        keymap.of([
          { key: 'Mod-d', run: duplicateSelection },
          { key: 'Alt-ArrowUp', run: moveLinesUp },
          { key: 'Alt-ArrowDown', run: moveLinesDown },
          { key: 'Shift-Mod-k', run: deleteLines },
          { key: 'Mod-Shift-\\', run: cursorMatchingBracket },
          { key: 'Mod-Shift-|', run: cursorMatchingBracket },
        ]),
      ),
      keymap.of(searchKeymap),
      // 缩进标记线（VS Code 风格 indent guides）：按缩进层级绘制竖线，当前代码块所在层级
      // 用 clay 色加粗高亮（highlightActiveBlock），嵌套结构一眼看清；配色随亮暗主题切换
      ...indentationMarkers({
        highlightActiveBlock: true,
        colors: {
          light: '#e5ded2',
          dark: '#3d3a34',
          activeLight: '#d97757',
          activeDark: '#d97757',
        },
      }),
    ]
    if (wrapText) base.push(EditorView.lineWrapping)
    if (!language) return base
    const factory = LANGUAGE_EXTENSIONS[language]
    const langExts: Extension[] = []
    if (factory) langExts.push(factory())
    // Markdown 原生无 commentTokens（Ctrl/⌘ + / 不生效），补上 HTML 块注释让 toggleComment 可用
    if (language === 'markdown') {
      langExts.push(
        markdownLanguage.data.of({
          commentTokens: { block: { open: '<!--', close: '-->' } },
        }),
      )
    }
    return [...langExts, ...base]
  }, [language, wrapText])

  // 标签显示名：basename 重复时（如两个目录下各有 index.md）带上父目录段区分，无冲突保持纯文件名
  const tabLabels = useMemo(() => {
    const baseOf = (p: string) => p.split('/').pop() || p
    const counts = new Map<string, number>()
    tabs.forEach((t) => counts.set(baseOf(t.path), (counts.get(baseOf(t.path)) ?? 0) + 1))
    const labels = new Map<string, string>()
    tabs.forEach((t) => {
      const base = baseOf(t.path)
      if ((counts.get(base) ?? 0) > 1) {
        const segs = t.path.split('/')
        const parent = segs[segs.length - 2]
        labels.set(t.id, parent ? `${parent}/${base}` : base)
      } else {
        labels.set(t.id, base)
      }
    })
    return labels
  }, [tabs])

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
  const isHtml = /\.html?$/i.test(file.path)
  // Markdown 预览用富文本渲染，HTML 预览用沙箱 iframe（内联本地 CSS/JS）；两者共用三态切换
  const canPreview = isMd || isHtml
  const showEditor = !canPreview || mdView !== 'preview'
  const showPreview = canPreview && mdView !== 'edit'

  // 浮动工具条定位：优先显示在选区上方，空间不足时放下方，并限制在视口内
  const toolbarLeft = Math.min(Math.max(selState?.x ?? 0, 8), window.innerWidth - 300)
  const toolbarTop =
    selState && selState.yTop > 100 ? selState.yTop - 42 : (selState?.yBottom ?? 0) + 8

  return (
    <div className="flex h-full flex-col">
      {/* 标签栏（外层容纳固定右侧的溢出下拉按钮，内层横向滚动） */}
      {tabs.length > 0 && (
        <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-secondary/50 px-1.5 pt-1.5">
          <div ref={tabStripRef} className="thin-scrollbar flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto">
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
                    onDoubleClick={(e) => {
                      // 双击标签任意位置关闭（单击切换 / 中键关闭 / 右键菜单均保留）
                      e.preventDefault()
                      onCloseTab(tab.id)
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
                      {tabLabels.get(tab.id) ?? tab.path.split('/').pop()}
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
          {/* 标签总览：标签较多时（>5）固定右侧下拉，点击切换（含未保存点与当前高亮） */}
          {tabs.length > 5 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="ml-0.5 flex shrink-0 items-center self-start rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                  title={`全部标签（${tabs.length} 个）`}
                  aria-label={`全部标签（${tabs.length} 个）`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
                {tabs.map((tab) => {
                  const isDirty = (tabStates[tab.id] ?? 'saved') !== 'saved'
                  const name = tab.path.split('/').pop() || tab.path
                  return (
                    <DropdownMenuItem
                      key={tab.id}
                      onSelect={() => onSwitchTab(tab.id)}
                      className={tab.id === activeId ? 'bg-clay/10 text-clay' : undefined}
                    >
                      <span className="min-w-0 flex-1 truncate" title={tab.path}>
                        {name}
                      </span>
                      {isDirty && (
                        <span
                          className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-clay"
                          title="未保存"
                        />
                      )}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
        {/* 下载当前文件（含未保存的修改，file.content 与编辑器实时同步） */}
        <button
          type="button"
          onClick={() => {
            const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = file.path.split('/').pop() || 'file.txt'
            document.body.appendChild(a)
            a.click()
            a.remove()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
          }}
          title="下载当前文件（含未保存的修改）"
          aria-label="下载当前文件"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          <Download className="h-3 w-3" />
        </button>
        {/* JSON 格式化（仅 json 文件显示）：2 空格缩进整文重排，走撤销栈可还原 */}
        {file.language === 'json' && (
          <button
            type="button"
            onClick={handleFormatJson}
            title="格式化 JSON（2 空格缩进，Ctrl/⌘ + Z 可还原）"
            aria-label="格式化 JSON"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            <Braces className="h-3 w-3" />
          </button>
        )}
        {/* 历史版本：每次内容变更自动快照，可预览 / 对比 / 一键回滚 */}
        <button
          type="button"
          onClick={onOpenHistory}
          title="历史版本（保存 / AI 应用自动快照，可回滚）"
          aria-label="历史版本"
          data-testid="history-btn"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          <History className="h-3 w-3" />
        </button>
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
        {showEditor && (
          <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-secondary/60 p-0.5">
            <button
              type="button"
              onClick={foldAllLines}
              disabled={!cursorInfo}
              title="折叠全部代码块（Ctrl/⌘ + Alt + [）"
              aria-label="折叠全部"
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronsDownUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={unfoldAllLines}
              disabled={!cursorInfo}
              title="展开全部代码块（Ctrl/⌘ + Alt + ]）"
              aria-label="展开全部"
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronsUpDown className="h-3 w-3" />
            </button>
          </div>
        )}
        {isMd && mdView !== 'preview' && (
          <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-secondary/60 p-0.5">
            <button
              type="button"
              onClick={() => mdWrap('**', '**', '加粗文字')}
              title="加粗（选中则包裹）"
              aria-label="Markdown 加粗"
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              <Bold className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => mdWrap('*', '*', '斜体文字')}
              title="斜体（选中则包裹）"
              aria-label="Markdown 斜体"
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              <Italic className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => mdWrap('`', '`', 'code')}
              title="行内代码（选中则包裹）"
              aria-label="Markdown 行内代码"
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              <Code className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={mdInsertLink}
              title="插入链接（选中文字作链接文字）"
              aria-label="Markdown 链接"
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              <Link2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={mdToggleHeading}
              title="标题切换（当前行加 / 移除 ##）"
              aria-label="Markdown 标题切换"
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              <Heading2 className="h-3 w-3" />
            </button>
          </div>
        )}
        {canPreview && (
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
        <button
          type="button"
          onClick={() => void copyFileContent()}
          title="复制文件全部内容"
          aria-label="复制文件全部内容"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-clay"
        >
          {copiedFile ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
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
            {isMd ? (
              <div className="thin-scrollbar min-w-0 flex-1 overflow-auto bg-card">
                <div className="markdown-preview mx-auto max-w-3xl px-6 py-5">
                  <AiMessage content={file.content} />
                </div>
              </div>
            ) : (
              <HtmlPreviewFrame
                path={file.path}
                content={file.content}
                openFiles={openFilesMap}
                resolveFile={resolvePreviewFile ?? (async () => null)}
              />
            )}
          </>
        )}
      </div>

      {/* 状态栏：光标位置 / 选区统计 / 字符数 */}
      {cursorInfo && (
        <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-secondary/40 px-3 text-[11px] text-muted-foreground">
          {showEditor &&
            (onOpenGoto ? (
              <button
                type="button"
                onClick={onOpenGoto}
                title="转到行（Ctrl/⌘ + G）"
                className="rounded transition-colors hover:text-foreground"
              >
                行 {cursorInfo.line}，列 {cursorInfo.col}
              </button>
            ) : (
              <span>
                行 {cursorInfo.line}，列 {cursorInfo.col}
              </span>
            ))}
          {showEditor && cursorInfo.selChars > 0 && (
            <span className="text-clay">
              已选 {cursorInfo.selLines > 1 ? `${cursorInfo.selLines} 行 / ` : ''}
              {cursorInfo.selChars} 字符
            </span>
          )}
          <span className="ml-auto flex items-center gap-2.5">
            {language && <span>{LANGUAGE_LABELS[language] ?? language}</span>}
            <span>
              共 {cursorInfo.totalLines.toLocaleString()} 行 · {cursorInfo.totalChars.toLocaleString()} 字符
            </span>
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
            {selState.text.length > 0 &&
              ` · ${selState.text.length.toLocaleString()} 字符`}
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
