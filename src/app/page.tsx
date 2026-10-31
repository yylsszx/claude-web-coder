'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { useMounted } from '@/hooks/use-mounted'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { Github, Sparkles, Loader2, FileCode2, Search, Download, Keyboard, Undo2, Moon, Sun, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Save, Hash, Trash2, RotateCcw } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ToastAction } from '@/components/ui/toast'
import { useToast } from '@/hooks/use-toast'
import { useIsMobile } from '@/hooks/use-mobile'
import { FileTree } from '@/components/workspace/file-tree'
import { CodeEditor, type JumpTarget, type SaveState, type SelectionAction, type SelectionPayload } from '@/components/workspace/code-editor'
import { ChatPanel } from '@/components/workspace/chat-panel'
import { GlobalSearch } from '@/components/workspace/global-search'
import { DiffDialog } from '@/components/workspace/diff-dialog'
import { SaveAsDialog, suggestFileName } from '@/components/workspace/save-as-dialog'
import { ApplyTargetDialog } from '@/components/workspace/apply-target-dialog'
import { ShortcutsDialog } from '@/components/workspace/shortcuts-dialog'
import pkg from '../../package.json'
import type { ChatMsg, FileFull, FileMeta, SessionMeta } from '@/lib/types'

const REPO_URL = 'https://github.com/yylsszx/claude-web-coder'

export default function WorkspacePage() {
  const { toast } = useToast()
  const isMobile = useIsMobile()
  const { resolvedTheme, setTheme } = useTheme()
  // 主题图标/提示语仅在客户端挂载后根据 resolvedTheme 渲染，避免 SSR hydration mismatch
  const themeMounted = useMounted()

  // ===== 文件与标签页状态 =====
  const [files, setFiles] = useState<FileMeta[]>([])
  const [openTabs, setOpenTabs] = useState<FileFull[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [tabStates, setTabStates] = useState<Record<string, SaveState>>({})

  // ===== 聊天状态 =====
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [chatLoading, setChatLoading] = useState(false)
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)

  // ===== 快速打开 / 全局搜索 / 跳转 =====
  const [quickOpen, setQuickOpen] = useState(false)
  // 命令面板（Ctrl/⌘ + K）：文件 / 会话 / 常用操作统一入口
  const [cmdOpen, setCmdOpen] = useState(false)
  // 转到行（Ctrl/⌘ + G）：定位当前文件指定行，复用 jumpTarget 机制
  const [gotoOpen, setGotoOpen] = useState(false)
  const [gotoValue, setGotoValue] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null)
  // 移动端 Tab 受控（AI 选区操作时自动切到对话）
  const [mobileTab, setMobileTab] = useState('chat')

  // ===== 面板折叠（专注模式）：折叠左文件树 / 右对话面板，编辑区占满 =====
  const leftPanelRef = useRef<ImperativePanelHandle>(null)
  const rightPanelRef = useRef<ImperativePanelHandle>(null)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)

  const toggleLeftPanel = useCallback(() => {
    const panel = leftPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }, [])
  const toggleRightPanel = useCallback(() => {
    const panel = rightPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }, [])

  // ===== 应用代码（目标选择 → diff 预览） / 存为新文件 / 拖拽导入 =====
  const [applyTargetOpen, setApplyTargetOpen] = useState(false)
  const [pendingApplyCode, setPendingApplyCode] = useState('')
  // 批量应用队列：多代码块依次走「选目标 → diff 确认」，取消即终止
  const [pendingBatch, setPendingBatch] = useState<{ codes: string[]; idx: number } | null>(null)
  const [diffState, setDiffState] = useState<{ file: FileFull; original: string; code: string } | null>(null)
  const [saveAsState, setSaveAsState] = useState<{ code: string; language: string; suggested: string } | null>(null)
  const [savingAs, setSavingAs] = useState(false)
  const [importingFiles, setImportingFiles] = useState(false)
  // 快捷键帮助面板（Ctrl/⌘ + /）
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // 最近一次 @ 引用的文件 ID（供应用目标对话框展示）
  const [recentMentionIds, setRecentMentionIds] = useState<string[]>([])
  // 上次应用目标文件 ID（应用目标对话框置顶提示）
  const [lastApplyTargetId, setLastApplyTargetId] = useState<string | null>(null)

  const activeTab = useMemo(
    () => openTabs.find((t) => t.id === activeTabId) ?? null,
    [openTabs, activeTabId]
  )

  // refs：异步回调中读取最新值
  const openTabsRef = useRef(openTabs)
  openTabsRef.current = openTabs
  // 最近关闭的标签（LIFO，Ctrl/⌘ + Shift + T 重开；仅记录仍存在的文件）
  const closedTabsRef = useRef<string[]>([])
  // 文件列表快照（reopenClosedTab 校验文件是否仍存在，避免陈旧闭包）
  const filesRef = useRef(files)
  useEffect(() => {
    filesRef.current = files
  }, [files])
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const activeSessionRef = useRef(activeSessionId)
  activeSessionRef.current = activeSessionId
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const abortRef = useRef<AbortController | null>(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  // 应用代码前的内容快照（供一键撤销）
  const undoRef = useRef<{ fileId: string; prevContent: string } | null>(null)
  // 编辑器「插入到光标」函数注册表（由 CodeEditor 注册）
  const insertToEditorRef = useRef<((text: string) => void) | null>(null)

  // ===== 会话 =====
  const refreshSessions = useCallback(async (): Promise<SessionMeta[]> => {
    const res = await fetch('/api/sessions')
    const data = await res.json()
    const list: SessionMeta[] = res.ok ? (data.sessions ?? []) : []
    setSessions(list)
    return list
  }, [])

  const loadMessages = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/chat?sessionId=${encodeURIComponent(sessionId)}`)
    const data = await res.json()
    if (res.ok) setMessages(data.messages ?? [])
  }, [])

  const switchSession = useCallback(
    async (id: string) => {
      if (activeSessionRef.current === id) return
      setActiveSessionId(id)
      setStreamingId(null)
      await loadMessages(id)
    },
    [loadMessages]
  )

  const createSession = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '创建失败')
      await refreshSessions()
      setActiveSessionId(data.session.id)
      setMessages([])
      setStreamingId(null)
    } catch (error) {
      toast({
        title: '新建会话失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        variant: 'destructive',
      })
    }
  }, [refreshSessions, toast])

  const renameSession = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? '重命名失败')
        await refreshSessions()
        return true
      } catch (error) {
        toast({
          title: '重命名失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        })
        return false
      }
    },
    [refreshSessions, toast]
  )

  /** 切换会话置顶（置顶后优先展示） */
  const toggleSessionPinned = useCallback(
    async (id: string, pinned: boolean) => {
      // 乐观更新：先改本地，再同步服务端
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, pinned } : s)))
      try {
        const res = await fetch(`/api/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinned }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? '置顶失败')
        await refreshSessions()
      } catch (error) {
        await refreshSessions()
        toast({
          title: pinned ? '置顶失败' : '取消置顶失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        })
      }
    },
    [refreshSessions, toast]
  )

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error ?? '删除失败')
        }
        // 同步清理该会话的输入草稿与输入历史，避免 localStorage 孤儿键
        try {
          localStorage.removeItem(`cw-chat-draft-${id}`)
          localStorage.removeItem(`cw-chat-hist-${id}`)
        } catch {
          /* 忽略 */
        }
        const list = await refreshSessions()
        if (activeSessionRef.current === id) {
          const next = list[0]
          if (next) {
            setActiveSessionId(next.id)
            await loadMessages(next.id)
          } else {
            setActiveSessionId(null)
            setMessages([])
          }
        }
        toast({ title: '会话已删除' })
      } catch (error) {
        toast({
          title: '删除会话失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        })
      }
    },
    [loadMessages, refreshSessions, toast]
  )

  // ===== 初始加载 =====
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [filesRes, sessionsRes] = await Promise.all([
          fetch('/api/files'),
          fetch('/api/sessions'),
        ])
        const filesData = await filesRes.json()
        const sessionsData = await sessionsRes.json()
        if (cancelled) return
        if (filesRes.ok) setFiles(filesData.files ?? [])
        const list: SessionMeta[] = sessionsRes.ok ? (sessionsData.sessions ?? []) : []
        setSessions(list)
        if (list.length > 0) {
          setActiveSessionId(list[0].id)
          const chatRes = await fetch(`/api/chat?sessionId=${encodeURIComponent(list[0].id)}`)
          const chatData = await chatRes.json()
          if (!cancelled && chatRes.ok) setMessages(chatData.messages ?? [])
        }
      } finally {
        if (!cancelled) setInitialLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
      // 卸载时清理所有自动保存定时器
      Object.values(saveTimersRef.current).forEach(clearTimeout)
    }
  }, [])

  // 挂载后同步一次面板折叠状态：autoSaveId 恢复的布局可能自带折叠尺寸（size=0），
  // 此时不会触发 onCollapse，需主动校正按钮图标与手柄显隐
  useEffect(() => {
    if (isMobile) return
    const raf = requestAnimationFrame(() => {
      if ((leftPanelRef.current?.getSize() ?? 1) <= 0.1) setLeftCollapsed(true)
      if ((rightPanelRef.current?.getSize() ?? 1) <= 0.1) setRightCollapsed(true)
    })
    return () => cancelAnimationFrame(raf)
  }, [isMobile])

  // ===== 保存 =====
  const saveTab = useCallback(
    async (tabId: string, contentOverride?: string): Promise<boolean> => {
      const tab = openTabsRef.current.find((t) => t.id === tabId)
      if (!tab) return false
      const content = contentOverride ?? tab.content
      setTabStates((prev) => ({ ...prev, [tabId]: 'saving' }))
      try {
        const res = await fetch(`/api/files/${tabId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error ?? '保存失败')
        }
        setOpenTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, content } : t))
        )
        setTabStates((prev) => ({ ...prev, [tabId]: 'saved' }))
        return true
      } catch (error) {
        setTabStates((prev) => ({ ...prev, [tabId]: 'dirty' }))
        toast({
          title: '保存失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        })
        return false
      }
    },
    [toast]
  )

  /** 一键保存全部未保存文件（工具栏「全部保存」/ Ctrl/⌘ + Alt + S） */
  const saveAllDirty = useCallback(async () => {
    const dirty = openTabsRef.current.filter((t) => tabStates[t.id] === 'dirty')
    if (!dirty.length) return
    // 先取消这些标签的待执行自动保存，避免与手动保存竞态
    dirty.forEach((t) => {
      if (saveTimersRef.current[t.id]) {
        clearTimeout(saveTimersRef.current[t.id])
        delete saveTimersRef.current[t.id]
      }
    })
    const results = await Promise.all(dirty.map((t) => saveTab(t.id)))
    const ok = results.filter(Boolean).length
    const fail = results.length - ok
    if (fail === 0) {
      toast({ title: `已保存 ${ok} 个文件` })
    } else {
      toast({
        title: `${fail} 个文件保存失败`,
        description: '详情见对应标签页的错误提示',
        variant: 'destructive',
      })
    }
  }, [saveTab, tabStates, toast])

  const scheduleSave = useCallback(
    (tabId: string, content: string) => {
      if (saveTimersRef.current[tabId]) clearTimeout(saveTimersRef.current[tabId])
      saveTimersRef.current[tabId] = setTimeout(() => void saveTab(tabId, content), 1000)
    },
    [saveTab]
  )

  // ===== 文件操作 =====
  const refreshFiles = useCallback(async () => {
    const res = await fetch('/api/files')
    const data = await res.json()
    if (res.ok) setFiles(data.files ?? [])
  }, [])

  const openFile = useCallback(
    async (id: string) => {
      // 已打开 → 仅切换
      if (openTabsRef.current.some((t) => t.id === id)) {
        setActiveTabId(id)
        return
      }
      try {
        const res = await fetch(`/api/files/${id}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? '打开文件失败')
        const file: FileFull = data.file
        setOpenTabs((prev) => [...prev, file])
        setTabStates((prev) => ({ ...prev, [file.id]: 'saved' }))
        setActiveTabId(file.id)
      } catch (error) {
        toast({
          title: '打开文件失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        })
      }
    },
    [toast]
  )

  const closeTab = useCallback(
    async (id: string) => {
      const tab = openTabsRef.current.find((t) => t.id === id)
      if (!tab) return
      // 记入关闭栈（去重后置顶，上限 20），供 Ctrl/⌘ + Shift + T 重开
      closedTabsRef.current = [...closedTabsRef.current.filter((tid) => tid !== id), id].slice(-20)
      // 未保存则先保存
      if (saveTimersRef.current[id]) {
        clearTimeout(saveTimersRef.current[id])
        delete saveTimersRef.current[id]
      }
      if (tabStates[id] === 'dirty') await saveTab(id)
      setOpenTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id)
        const next = prev.filter((t) => t.id !== id)
        // 若关闭的是激活标签，激活相邻标签
        setActiveTabId((cur) => {
          if (cur !== id) return cur
          if (!next.length) return null
          return next[Math.min(idx, next.length - 1)].id
        })
        return next
      })
      setTabStates((prev) => {
        const { [id]: _removed, ...rest } = prev
        return rest
      })
    },
    [saveTab, tabStates]
  )

  /** 右键菜单：关闭除指定标签外的所有标签（未保存的先自动保存） */
  const closeOtherTabs = useCallback(
    async (id: string) => {
      const snapshot = openTabsRef.current.map((t) => t.id)
      for (const tid of snapshot) {
        if (tid !== id) await closeTab(tid)
      }
    },
    [closeTab]
  )

  /** 右键菜单：关闭指定标签右侧的所有标签 */
  const closeRightTabs = useCallback(
    async (id: string) => {
      const idx = openTabsRef.current.findIndex((t) => t.id === id)
      if (idx < 0) return
      const rightIds = openTabsRef.current.slice(idx + 1).map((t) => t.id)
      for (const tid of rightIds) {
        await closeTab(tid)
      }
    },
    [closeTab]
  )

  /** 右键菜单：关闭全部标签 */
  const closeAllTabs = useCallback(async () => {
    const snapshot = openTabsRef.current.map((t) => t.id)
    for (const tid of snapshot) {
      await closeTab(tid)
    }
  }, [closeTab])

  /** Ctrl/⌘ + Shift + T：重开最近关闭的标签（已删除的文件自动跳过；重开后出栈，连按继续回溯更早的） */
  const reopenClosedTab = useCallback(async () => {
    const stack = closedTabsRef.current
    while (stack.length) {
      const id = stack[stack.length - 1]
      if (filesRef.current.some((f) => f.id === id)) {
        stack.pop()
        await openFile(id)
        return
      }
      // 文件已被删除，弹出后继续找上一个
      stack.pop()
    }
    toast({ title: '没有可重新打开的标签' })
  }, [openFile, toast])

  // Ctrl/⌘ + P 快速打开；Ctrl/⌘ + Shift + F 全局搜索；Ctrl/⌘ + S 保存；Ctrl/⌘ + / 快捷键帮助
  // （置于此处：依赖的 reopenClosedTab 在上方定义，避免 TDZ）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        const tab = activeTabRef.current
        if (!tab) return
        if (saveTimersRef.current[tab.id]) {
          clearTimeout(saveTimersRef.current[tab.id])
          delete saveTimersRef.current[tab.id]
        }
        void saveTab(tab.id)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setQuickOpen((prev) => !prev)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdOpen((prev) => !prev)
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
      } else if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setShortcutsOpen((prev) => !prev)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        // Ctrl/⌘ + B 折叠/展开左文件树；Ctrl/⌘ + Alt + B 折叠/展开右对话面板
        e.preventDefault()
        if (e.altKey) toggleRightPanel()
        else toggleLeftPanel()
      } else if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 's') {
        // Ctrl/⌘ + Alt + S 保存全部未保存文件
        e.preventDefault()
        void saveAllDirty()
      } else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'g') {
        // Ctrl/⌘ + G 转到行（需有打开的标签）
        e.preventDefault()
        if (activeTabRef.current) {
          setGotoValue('')
          setGotoOpen(true)
        }
      } else if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        // Ctrl/⌘ + Alt + ←/→ 在打开的标签间循环切换
        e.preventDefault()
        const tabs = openTabsRef.current
        if (!tabs.length) return
        const curIdx = tabs.findIndex((t) => t.id === activeTabRef.current?.id)
        const dir = e.key === 'ArrowLeft' ? -1 : 1
        const next = tabs[(((curIdx + dir) % tabs.length) + tabs.length) % tabs.length]
        if (next) setActiveTabId(next.id)
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 't') {
        // Ctrl/⌘ + Shift + T 重开最近关闭的标签
        e.preventDefault()
        void reopenClosedTab()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveTab, saveAllDirty, toggleLeftPanel, toggleRightPanel, reopenClosedTab])

  // 有未保存更改时拦截刷新 / 关闭，防误触丢失（自动保存间隔内的输入、自动保存失败的改动）
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.values(tabStates).some((s) => s === 'dirty')) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [tabStates])

  /** 拖拽排序：把 fromId 标签移动到 toId 位置 */
  const reorderTabs = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return
    setOpenTabs((prev) => {
      const from = prev.findIndex((t) => t.id === fromId)
      const to = prev.findIndex((t) => t.id === toId)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  const handleEditorChange = useCallback(
    (value: string) => {
      const tab = activeTabRef.current
      if (!tab || tab.content === value) return
      setOpenTabs((prev) =>
        prev.map((t) => (t.id === tab.id ? { ...t, content: value } : t))
      )
      setTabStates((prev) => ({ ...prev, [tab.id]: 'dirty' }))
      scheduleSave(tab.id, value)
    },
    [scheduleSave]
  )

  const createFile = useCallback(
    async (path: string): Promise<boolean> => {
      try {
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? '创建失败')
        await refreshFiles()
        await openFile(data.file.id)
        toast({ title: '文件已创建', description: path })
        return true
      } catch (error) {
        toast({
          title: '创建文件失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        })
        return false
      }
    },
    [openFile, refreshFiles, toast]
  )

  const renameFile = useCallback(
    async (id: string, newPath: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/files/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: newPath }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? '重命名失败')
        await refreshFiles()
        setOpenTabs((prev) =>
          prev.map((t) =>
            t.id === id
              ? { ...t, path: newPath, language: data.file?.language ?? t.language }
              : t
          )
        )
        toast({ title: '已重命名', description: newPath })
        return true
      } catch (error) {
        toast({
          title: '重命名失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        })
        return false
      }
    },
    [refreshFiles, toast]
  )

  const deleteFile = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/files/${id}`, { method: 'DELETE' })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error ?? '删除失败')
        }
        await closeTab(id)
        await refreshFiles()
        toast({ title: '文件已删除' })
      } catch (error) {
        toast({
          title: '删除失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        })
      }
    },
    [closeTab, refreshFiles, toast]
  )

  // ===== 聊天（流式，支持停止生成 / 重新生成 / 编辑重发 / @ 引用） =====
  const runStream = useCallback(
    async (opts: {
      message: string
      regenerate?: boolean
      editMessageId?: string
      /** 是否把当前打开的文件作为上下文发给 AI（默认 true；重新生成/编辑重发不受影响） */
      includeFile?: boolean
      /** @ 引用的文件 ID 列表（仅普通发送；发送前逐个拉取内容传给后端） */
      mentionIds?: string[]
    }) => {
      const { message, regenerate, editMessageId, includeFile = true, mentionIds } = opts
      // 防止并发请求：已有流式请求进行中时忽略
      if (abortRef.current) return
      const startedAt = Date.now()
      const tempUserId = `tmp-u-${Date.now()}`
      const streamId = `tmp-a-${Date.now()}`
      const now = new Date().toISOString()
      setMessages((prev) => {
        if (regenerate) {
          // 重新生成：用户消息已在界面中，仅追加流式占位
          return [
            ...prev,
            { id: streamId, role: 'assistant' as const, content: '', createdAt: now },
          ]
        }
        if (editMessageId) {
          // 编辑重发：原地更新该用户消息内容，丢弃其后所有消息，追加流式占位
          const idx = prev.findIndex((m) => m.id === editMessageId)
          if (idx === -1) {
            return [
              ...prev,
              { id: streamId, role: 'assistant' as const, content: '', createdAt: now },
            ]
          }
          return [
            ...prev.slice(0, idx),
            { ...prev[idx], content: message },
            { id: streamId, role: 'assistant' as const, content: '', createdAt: now },
          ]
        }
        return [
          ...prev,
          { id: tempUserId, role: 'user' as const, content: message, createdAt: now },
          { id: streamId, role: 'assistant' as const, content: '', createdAt: now },
        ]
      })
      setChatLoading(true)
      setStreamingId(streamId)

      const controller = new AbortController()
      abortRef.current = controller

      // @ 引用文件：发送前逐个拉取内容（最多 5 个，服务端还会再校验/截断）
      let referencedFiles: { path: string; content: string; language?: string }[] = []
      if (mentionIds?.length) {
        const fetched = await Promise.all(
          mentionIds.slice(0, 5).map(async (id) => {
            try {
              const res = await fetch(`/api/files/${id}`)
              if (!res.ok) return null
              const data = await res.json()
              const f = data.file
              return f ? { path: f.path, content: f.content, language: f.language } : null
            } catch {
              return null
            }
          })
        )
        referencedFiles = fetched.filter((f): f is NonNullable<typeof f> => f !== null)
      }

      const tab = activeTabRef.current
      const sessionId = activeSessionRef.current
      let pending = ''
      let flushTimer: ReturnType<typeof setTimeout> | null = null
      // 流是否已建立：流开始前失败（网络不通 / 上游失败已回滚）与中途错误的重试语义不同
      let streamStarted = false
      const flush = () => {
        flushTimer = null
        if (!pending) return
        const chunk = pending
        pending = ''
        setMessages((prev) =>
          prev.map((m) => (m.id === streamId ? { ...m, content: m.content + chunk } : m))
        )
      }

      try {
        const res = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            message,
            sessionId,
            regenerate,
            editMessageId,
            currentFile:
              includeFile && tab
                ? { path: tab.path, content: tab.content, language: tab.language }
                : null,
            referencedFiles: referencedFiles.length ? referencedFiles : undefined,
          }),
        })
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? 'AI 调用失败')
        }
        // 流已建立：此后出错时用户消息已在服务端持久化，重试需走 regenerate 语义
        streamStarted = true
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let errorMsg: string | null = null
        let doneIds: {
          userMessageId: string
          assistantMessageId: string
          sessionId: string
          sessionTitle: string
        } | null = null

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''
          for (const part of parts) {
            const line = part.trim()
            if (!line.startsWith('data:')) continue
            const frame = JSON.parse(line.slice(5).trim())
            if (frame.t === 'delta') {
              pending += frame.v
              if (!flushTimer) flushTimer = setTimeout(flush, 60)
            } else if (frame.t === 'done') {
              doneIds = frame
            } else if (frame.t === 'error') {
              errorMsg = frame.v
            }
          }
        }
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        flush()

        if (errorMsg) throw new Error(errorMsg)
        if (doneIds) {
          const ids = doneIds
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamId
                ? { ...m, id: ids.assistantMessageId, durationMs: Date.now() - startedAt }
                : m.id === tempUserId
                  ? { ...m, id: ids.userMessageId }
                  : m
            )
          )
          // 会话可能被服务端自动命名/更新，刷新列表
          void refreshSessions()
        }
      } catch (error) {
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        if (controller.signal.aborted) {
          // 用户点击「停止生成」：保留用户消息与已流出的部分内容
          flush()
          setMessages((prev) =>
            prev.filter((m) => m.id !== streamId || m.content.trim() !== '')
          )
          void refreshSessions()
          toast({ title: '已停止生成', description: '已生成的部分内容将保留' })
        } else if (streamStarted) {
          // 中途流式错误：用户消息已持久化 → 保留（避免 UI 与库不一致）；重试走 regenerate 语义
          setMessages((prev) => prev.filter((m) => m.id !== streamId))
          void refreshSessions()
          toast({
            title: 'AI 调用失败',
            description: error instanceof Error ? error.message : '请稍后重试',
            variant: 'destructive',
            action: (
              <ToastAction
                altText="重试"
                onClick={() => {
                  if (editMessageId) void runStream({ message, editMessageId })
                  else void runStream({ message, regenerate: true })
                }}
              >
                重试
              </ToastAction>
            ),
          })
        } else {
          // 流开始前失败（请求未达服务端 / 上游失败已回滚用户消息）：移除临时消息保持 UI 与库一致；原样重发重试
          setMessages((prev) =>
            prev.filter((m) => m.id !== streamId && m.id !== tempUserId)
          )
          toast({
            title: 'AI 调用失败',
            description: error instanceof Error ? error.message : '请稍后重试',
            variant: 'destructive',
            action: (
              <ToastAction
                altText="重试"
                onClick={() => {
                  if (editMessageId) void runStream({ message, editMessageId })
                  else if (regenerate) void runStream({ message, regenerate: true })
                  else void runStream({ message, includeFile, mentionIds })
                }}
              >
                重试
              </ToastAction>
            ),
          })
        }
      } finally {
        abortRef.current = null
        setChatLoading(false)
        setStreamingId(null)
      }
    },
    [refreshSessions, toast]
  )

  /** 发送消息（普通模式）；includeFile 由附件 chip 控制，mentionIds 为 @ 引用文件 */
  const sendMessage = useCallback(
    (message: string, includeFile = true, mentionIds?: string[]) => {
      if (mentionIds?.length) setRecentMentionIds(mentionIds)
      void runStream({ message, includeFile, mentionIds })
    },
    [runStream]
  )

  /** 重新生成最后一条 AI 回复：复用服务端存储的最后一条用户消息 */
  const regenerateLast = useCallback(async () => {
    if (abortRef.current) return
    const msgs = messagesRef.current
    if (msgs.length === 0 || msgs[msgs.length - 1].role !== 'assistant') return
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    // 移除最后一条 AI 回复，用户消息保留（服务端同步删除旧回复后重新流式生成）
    setMessages(msgs.slice(0, -1))
    await runStream({ message: lastUser.content, regenerate: true })
  }, [runStream])

  /** 编辑历史用户消息并重发：服务端更新该消息并丢弃其后所有消息，重新流式生成 */
  const editAndResend = useCallback(
    async (messageId: string, newContent: string) => {
      const trimmed = newContent.trim()
      if (!trimmed || abortRef.current) return
      await runStream({ message: trimmed, editMessageId: messageId })
    },
    [runStream]
  )

  /** 编辑器选中代码 → AI 快捷处理（解释 / 优化 / 修复） */
  const askAboutSelection = useCallback(
    (action: SelectionAction, sel: SelectionPayload) => {
      if (abortRef.current) return
      const lineRange =
        sel.fromLine === sel.toLine ? `第 ${sel.fromLine} 行` : `第 ${sel.fromLine}-${sel.toLine} 行`
      const goal =
        action === 'explain'
          ? '逐段解释这段代码的作用'
          : action === 'optimize'
            ? '优化该文件中以下代码片段（可读性、性能与健壮性），并输出修改后的完整文件内容'
            : '检查该文件中以下代码片段的潜在 Bug，并输出修复后的完整文件内容'
      const prompt =
        `请${goal}。代码来自文件 ${sel.path} ${lineRange}：\n\n` +
        '```' + sel.language + '\n' + sel.text + '\n```'
      if (isMobile) setMobileTab('chat')
      void runStream({ message: prompt })
    },
    [isMobile, runStream]
  )

  /** 停止当前 AI 生成（已生成的部分内容保留） */
  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearChat = useCallback(async () => {
    const sessionId = activeSessionRef.current
    if (!sessionId) return
    try {
      const res = await fetch(`/api/chat?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '清空失败')
      setMessages(data.messages ?? [])
      void refreshSessions()
    } catch (error) {
      toast({
        title: '清空失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        variant: 'destructive',
      })
    }
  }, [refreshSessions, toast])

  /** 把 AI 代码写入目标文件（供撤销）；目标 tab 未打开时直接创建 tab */
  const applyToTarget = useCallback(
    (target: FileFull & { prevContent: string }, code: string) => {
      undoRef.current = { fileId: target.id, prevContent: target.prevContent }
      setOpenTabs((prev) => {
        const exists = prev.some((t) => t.id === target.id)
        if (!exists) {
          return [
            ...prev,
            {
              id: target.id,
              path: target.path,
              language: target.language,
              content: code,
              createdAt: target.createdAt,
              updatedAt: target.updatedAt,
            },
          ]
        }
        return prev.map((t) => (t.id === target.id ? { ...t, content: code } : t))
      })
      setTabStates((prev) => ({ ...prev, [target.id]: 'dirty' }))
      scheduleSave(target.id, code)
      setActiveTabId(target.id)
      setLastApplyTargetId(target.id)
      toast({
        title: '已应用到文件',
        description: target.path,
        action: (
          <ToastAction
            altText="撤销本次应用"
            className="gap-1 text-clay hover:text-clay"
            onClick={() => {
              const snap = undoRef.current
              if (!snap) return
              undoRef.current = null
              setOpenTabs((prev) =>
                prev.map((t) => (t.id === snap.fileId ? { ...t, content: snap.prevContent } : t))
              )
              setTabStates((prev) => ({ ...prev, [snap.fileId]: 'dirty' }))
              scheduleSave(snap.fileId, snap.prevContent)
              toast({ title: '已撤销', description: '文件已恢复为应用前的内容' })
            }}
          >
            <Undo2 className="h-3 w-3" />
            撤销
          </ToastAction>
        ),
      })
    },
    [scheduleSave, toast]
  )

  /** 点击「应用到文件…」→ 打开目标选择对话框 */
  const openApplyTarget = useCallback(
    (code: string) => {
      if (!files.length) {
        toast({ title: '工作区还没有文件', variant: 'destructive' })
        return
      }
      setPendingBatch(null)
      setPendingApplyCode(code)
      setApplyTargetOpen(true)
    },
    [files.length, toast]
  )

  /** 批量应用全部代码块：从第一段开始逐段选择目标，diff 确认后自动衔接下一段 */
  const openApplyAll = useCallback(
    (codes: string[]) => {
      if (!files.length) {
        toast({ title: '工作区还没有文件', variant: 'destructive' })
        return
      }
      if (!codes.length) return
      setPendingBatch({ codes, idx: 0 })
      setPendingApplyCode(codes[0])
      setApplyTargetOpen(true)
    },
    [files.length, toast]
  )

  /** 选中目标文件：拉取内容后进入 diff 预览（未打开的文件也支持） */
  const pickApplyTarget = useCallback(
    async (fileId: string) => {
      setApplyTargetOpen(false)
      try {
        const res = await fetch(`/api/files/${fileId}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? '读取文件失败')
        const f: FileFull = data.file
        setDiffState({
          file: f,
          original: f.content,
          code: pendingApplyCode,
        })
      } catch (error) {
        toast({
          title: '读取文件失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        })
      }
    },
    [pendingApplyCode, toast]
  )

  /** diff 确认后真正应用并关闭（content 为按块选择重建后的内容）；批量队列未完则自动弹出下一段的目标选择 */
  const confirmDiff = useCallback((content: string) => {
    if (!diffState) return
    applyToTarget({ ...diffState.file, prevContent: diffState.original }, content)
    setDiffState(null)
    if (pendingBatch && pendingBatch.idx < pendingBatch.codes.length - 1) {
      const idx = pendingBatch.idx + 1
      setPendingBatch({ ...pendingBatch, idx })
      setPendingApplyCode(pendingBatch.codes[idx])
      setApplyTargetOpen(true)
    } else {
      setPendingBatch(null)
    }
  }, [applyToTarget, diffState, pendingBatch])

  /** 点击「存为新文件」→ 打开命名对话框 */
  const openSaveAs = useCallback((code: string, language: string) => {
    setSaveAsState({ code, language, suggested: suggestFileName(language) })
  }, [])

  /** 确认存为新文件：创建文件（含内容）并打开标签 */
  const confirmSaveAs = useCallback(
    async (path: string) => {
      if (!saveAsState) return
      setSavingAs(true)
      try {
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content: saveAsState.code }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? '创建失败')
        await refreshFiles()
        await openFile(data.file.id)
        setSaveAsState(null)
        toast({ title: '已保存为新文件', description: path })
      } catch (error) {
        toast({
          title: '保存失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        })
      } finally {
        setSavingAs(false)
      }
    },
    [openFile, refreshFiles, saveAsState, toast]
  )

  /** 导出当前会话为 Markdown 文件（每条消息带时间戳，文件名带日期） */
  const exportChat = useCallback(() => {
    const msgs = messagesRef.current
    if (!msgs.length) return
    const title =
      sessions.find((s) => s.id === activeSessionRef.current)?.title ?? '会话'
    const now = new Date()
    const stamp = now.toLocaleString('zh-CN', { hour12: false })
    const body = msgs
      .map((m) => {
        const t = new Date(m.createdAt)
        const time = Number.isNaN(t.getTime())
          ? ''
          : `（${t.toLocaleString('zh-CN', { hour12: false })}）`
        return `## ${m.role === 'user' ? '🙋 用户' : '✨ AI'}${time}\n\n${m.content.trim()}`
      })
      .join('\n\n---\n\n')
    const md = `# 会话：${title}\n\n> 导出自 Claude 风格 AI 编程工作台 · ${stamp} · 共 ${msgs.length} 条消息\n\n---\n\n${body}\n`
    const dateTag = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const safeName =
      title.replace(/[/\\:*?"<>|\s]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '') || 'chat'
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}-${dateTag}.md`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: '会话已导出', description: `${safeName}-${dateTag}.md` })
  }, [sessions, toast])

  /** 从全局搜索跳转：打开文件并定位到指定行 */
  const jumpToLine = useCallback(
    async (fileId: string, line: number) => {
      await openFile(fileId)
      setJumpTarget({ fileId, line, nonce: Date.now() })
    },
    [openFile]
  )

  /** 转到行（Ctrl/⌘ + G）：定位当前标签的指定行 */
  const handleGotoLine = useCallback(() => {
    const tab = activeTabRef.current
    const line = Number(gotoValue)
    if (!tab || !Number.isFinite(line) || line < 1) return
    setGotoOpen(false)
    void jumpToLine(tab.id, Math.floor(line))
  }, [gotoValue, jumpToLine])

  /** 拖拽本地文件到文件树导入工作区：重名自动加后缀，单文件限 1MB */
  const importDroppedFiles = useCallback(
    async (dropped: File[]) => {
      const candidates = dropped.filter(
        (f) => !(f.size === 0 && f.type === '' && !f.name.includes('.'))
      )
      if (!candidates.length) return
      setImportingFiles(true)
      try {
        // 以服务端最新列表为准生成不冲突路径
        const listRes = await fetch('/api/files')
        const listData = await listRes.json()
        const existing = new Set<string>(
          listRes.ok ? ((listData.files ?? []) as FileMeta[]).map((f) => f.path) : []
        )
        const batch: { path: string; content: string }[] = []
        const skipped: string[] = []
        const renamed: string[] = []
        for (const f of candidates) {
          if (f.size > 1024 * 1024) {
            skipped.push(`${f.name}（超过 1MB）`)
            continue
          }
          try {
            const content = await f.text()
            let path = f.name
            if (existing.has(path)) {
              const dot = f.name.lastIndexOf('.')
              const base = dot > 0 ? f.name.slice(0, dot) : f.name
              const ext = dot > 0 ? f.name.slice(dot) : ''
              let i = 1
              while (existing.has(`${base}-${i}${ext}`)) i++
              path = `${base}-${i}${ext}`
              renamed.push(`${f.name} → ${path}`)
            }
            existing.add(path)
            batch.push({ path, content })
          } catch {
            skipped.push(`${f.name}（无法读取）`)
          }
        }
        let imported = 0
        for (const item of batch) {
          try {
            const res = await fetch('/api/files', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item),
            })
            if (res.ok) {
              imported++
            } else {
              skipped.push(item.path)
            }
          } catch {
            skipped.push(item.path)
          }
        }
        await refreshFiles()
        const desc = [
          renamed.length ? `重命名：${renamed.join('、')}` : '',
          skipped.length ? `失败：${skipped.join('、')}` : '',
        ]
          .filter(Boolean)
          .join('；')
        if (imported > 0) {
          toast({ title: `已导入 ${imported} 个文件`, description: desc || undefined })
        } else {
          toast({ title: '导入失败', description: desc || '请稍后重试', variant: 'destructive' })
        }
      } finally {
        setImportingFiles(false)
      }
    },
    [refreshFiles, toast]
  )

  /** 注册编辑器插入函数（稳定标识，CodeEditor 挂载后调用） */
  const registerEditorInsert = useCallback((fn: (text: string) => void) => {
    insertToEditorRef.current = fn
  }, [])

  /** 注册编辑器选区读取函数（稳定标识；供命令面板「让 AI 解释选中代码」使用） */
  const editorSelectionRef = useRef<(() => SelectionPayload | null) | null>(null)
  const registerEditorSelection = useCallback((fn: () => SelectionPayload | null) => {
    editorSelectionRef.current = fn
  }, [])

  /** 命令面板入口：解释最近一次选中的代码（无选区时提示） */
  const explainSelectionFromPalette = useCallback(() => {
    const sel = editorSelectionRef.current?.()
    if (!sel) {
      toast({ title: '请先在编辑器中选中代码' })
      return
    }
    askAboutSelection('explain', sel)
  }, [askAboutSelection, toast])

  /** AI 代码块「插入到光标位置」：插入后移动端自动切到编辑器 Tab */
  const insertCodeToEditor = useCallback(
    (code: string) => {
      insertToEditorRef.current?.(code)
      if (isMobile) setMobileTab('editor')
    },
    [isMobile]
  )

  // ===== 视图 =====
  const fileTreeView = (
    <FileTree
      files={files}
      activeId={activeTabId}
      dirtyIds={Object.entries(tabStates)
        .filter(([, s]) => s !== 'saved')
        .map(([id]) => id)}
      onOpen={openFile}
      onCreate={createFile}
      onRename={renameFile}
      onDelete={deleteFile}
      onQuickOpen={() => setQuickOpen(true)}
      onImportFiles={(dropped) => void importDroppedFiles(dropped)}
      importingFiles={importingFiles}
    />
  )

  /** 未保存标签总数（工具栏「全部保存」与命令面板共用） */
  const dirtyCount = useMemo(
    () => Object.values(tabStates).filter((s) => s === 'dirty').length,
    [tabStates]
  )
  /** 最近更新的文件（编辑器空态快捷入口，最多 5 个） */
  const recentFiles = useMemo(
    () => [...files].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5),
    [files]
  )

  const editorView = (
    <CodeEditor
      tabs={openTabs}
      activeId={activeTabId}
      tabStates={tabStates}
      onSwitchTab={setActiveTabId}
      onCloseTab={closeTab}
      onCloseOtherTabs={closeOtherTabs}
      onCloseRightTabs={closeRightTabs}
      onCloseAllTabs={closeAllTabs}
      onReorderTabs={reorderTabs}
      onChange={handleEditorChange}
      jumpTarget={jumpTarget}
      onAskSelection={askAboutSelection}
      askDisabled={chatLoading}
      registerInsert={registerEditorInsert}
      registerSelectionGetter={registerEditorSelection}
      dirtyCount={dirtyCount}
      onSaveAll={() => void saveAllDirty()}
      recentFiles={recentFiles}
      onOpenFile={(id) => void openFile(id)}
      onQuickOpen={() => setQuickOpen(true)}
      onGlobalSearch={() => setSearchOpen(true)}
      onSave={() => {
        const tab = activeTabRef.current
        if (!tab) return
        if (saveTimersRef.current[tab.id]) {
          clearTimeout(saveTimersRef.current[tab.id])
          delete saveTimersRef.current[tab.id]
        }
        void saveTab(tab.id)
      }}
    />
  )

  const chatView = (
    <ChatPanel
      messages={messages}
      loading={chatLoading}
      streamingId={streamingId}
      activeFilePath={activeTab?.path ?? null}
      files={files}
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSwitchSession={switchSession}
      onCreateSession={createSession}
      onRenameSession={renameSession}
      onDeleteSession={deleteSession}
      onTogglePin={toggleSessionPinned}
      onSend={sendMessage}
      onStop={stopGeneration}
      onClear={clearChat}
      onApplyCode={openApplyTarget}
      onApplyAll={openApplyAll}
      onRegenerate={() => void regenerateLast()}
      onSaveAsCode={openSaveAs}
      onInsertCode={insertCodeToEditor}
      onExportChat={exportChat}
      onEditResend={(id, content) => void editAndResend(id, content)}
    />
  )

  /** 命令面板（Ctrl/⌘ + K）：操作 / 会话 / 文件统一入口 */
  const cmdPaletteView = (
    <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
      <CommandInput placeholder="搜索文件或会话，或执行操作…" />
      <CommandList>
        <CommandEmpty>没有匹配的结果</CommandEmpty>
        <CommandGroup heading="操作">
          <CommandItem
            value="新建会话"
            onSelect={() => {
              setCmdOpen(false)
              void createSession()
            }}
          >
            <MessageSquarePlus className="h-4 w-4 text-clay" />
            <span>新建会话</span>
          </CommandItem>
          <CommandItem
            value="切换深浅色模式 主题"
            onSelect={() => {
              setCmdOpen(false)
              setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
            }}
          >
            {themeMounted && resolvedTheme === 'dark' ? (
              <Sun className="h-4 w-4 text-clay" />
            ) : (
              <Moon className="h-4 w-4 text-clay" />
            )}
            <span>{themeMounted && resolvedTheme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}</span>
          </CommandItem>
          <CommandItem
            value="导出会话为 Markdown"
            onSelect={() => {
              setCmdOpen(false)
              exportChat()
            }}
          >
            <Download className="h-4 w-4 text-clay" />
            <span>导出会话为 Markdown</span>
          </CommandItem>
          {activeTab && (
            <CommandItem
              value="让 AI 解释选中代码"
              onSelect={() => {
                setCmdOpen(false)
                explainSelectionFromPalette()
              }}
            >
              <Sparkles className="h-4 w-4 text-clay" />
              <span>让 AI 解释选中代码</span>
            </CommandItem>
          )}
          <CommandItem
            value="快速打开文件"
            onSelect={() => {
              setCmdOpen(false)
              setQuickOpen(true)
            }}
          >
            <FileCode2 className="h-4 w-4 text-clay" />
            <span>快速打开文件…</span>
            <span className="ml-auto text-[10px] text-muted-foreground">⌘P</span>
          </CommandItem>
          <CommandItem
            value="全局搜索"
            onSelect={() => {
              setCmdOpen(false)
              setSearchOpen(true)
            }}
          >
            <Search className="h-4 w-4 text-clay" />
            <span>全局搜索…</span>
            <span className="ml-auto text-[10px] text-muted-foreground">⌘⇧F</span>
          </CommandItem>
          <CommandItem
            value="重新打开关闭的标签 撤销关闭"
            onSelect={() => {
              setCmdOpen(false)
              void reopenClosedTab()
            }}
          >
            <RotateCcw className="h-4 w-4 text-clay" />
            <span>重新打开关闭的标签</span>
            <span className="ml-auto text-[10px] text-muted-foreground">⌘⇧T</span>
          </CommandItem>
          {dirtyCount > 0 && (
            <CommandItem
              value="保存全部未保存文件"
              onSelect={() => {
                setCmdOpen(false)
                void saveAllDirty()
              }}
            >
              <Save className="h-4 w-4 text-clay" />
              <span>保存全部未保存文件（{dirtyCount}）</span>
              <span className="ml-auto text-[10px] text-muted-foreground">⌘⌥S</span>
            </CommandItem>
          )}
          {openTabs.length > 0 && (
            <CommandItem
              value="转到行 跳转行号"
              onSelect={() => {
                setCmdOpen(false)
                setGotoValue('')
                setGotoOpen(true)
              }}
            >
              <Hash className="h-4 w-4 text-clay" />
              <span>转到行…</span>
              <span className="ml-auto text-[10px] text-muted-foreground">⌘G</span>
            </CommandItem>
          )}
          <CommandItem
            value={leftCollapsed ? '展开文件树' : '折叠文件树'}
            onSelect={() => {
              setCmdOpen(false)
              toggleLeftPanel()
            }}
          >
            {leftCollapsed ? (
              <PanelLeftOpen className="h-4 w-4 text-clay" />
            ) : (
              <PanelLeftClose className="h-4 w-4 text-clay" />
            )}
            <span>{leftCollapsed ? '展开文件树' : '折叠文件树'}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">⌘B</span>
          </CommandItem>
          <CommandItem
            value={rightCollapsed ? '展开 AI 对话面板' : '折叠 AI 对话面板'}
            onSelect={() => {
              setCmdOpen(false)
              toggleRightPanel()
            }}
          >
            {rightCollapsed ? (
              <PanelRightOpen className="h-4 w-4 text-clay" />
            ) : (
              <PanelRightClose className="h-4 w-4 text-clay" />
            )}
            <span>{rightCollapsed ? '展开 AI 对话面板' : '折叠 AI 对话面板'}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">⌘⌥B</span>
          </CommandItem>
          {activeSessionId && messages.length > 0 && (
            <CommandItem
              value="清空当前会话对话"
              onSelect={() => {
                setCmdOpen(false)
                void clearChat()
              }}
            >
              <Trash2 className="h-4 w-4 text-clay" />
              <span>清空当前会话对话</span>
            </CommandItem>
          )}
          <CommandItem
            value="快捷键帮助"
            onSelect={() => {
              setCmdOpen(false)
              setShortcutsOpen(true)
            }}
          >
            <Keyboard className="h-4 w-4 text-clay" />
            <span>快捷键帮助</span>
            <span className="ml-auto text-[10px] text-muted-foreground">⌘/</span>
          </CommandItem>
        </CommandGroup>
        {sessions.length > 0 && (
          <CommandGroup heading="切换会话">
            {sessions.map((s) => (
              <CommandItem
                key={s.id}
                value={`会话 ${s.title}`}
                onSelect={() => {
                  setCmdOpen(false)
                  void switchSession(s.id)
                }}
              >
                <Sparkles className="h-4 w-4 text-clay" />
                <span className="truncate">{s.title}</span>
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {s.messageCount} 条
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {files.length > 0 && (
          <CommandGroup heading="打开文件">
            {files.map((f) => (
              <CommandItem
                key={f.id}
                value={f.path}
                onSelect={() => {
                  setCmdOpen(false)
                  void openFile(f.id)
                }}
              >
                <FileCode2 className="h-4 w-4 text-clay" />
                <span className="truncate font-mono text-[13px]">{f.path}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span className="tabular-nums">v{pkg.version}</span>
        <span>Esc 关闭 · Ctrl/⌘ K 唤起</span>
      </div>
    </CommandDialog>
  )

  /** 按目录分组供快速打开面板使用 */
  const quickOpenView = (
    <CommandDialog open={quickOpen} onOpenChange={setQuickOpen}>
      <CommandInput placeholder="输入文件名搜索…" />
      <CommandList>
        <CommandEmpty>没有匹配的文件</CommandEmpty>
        <CommandGroup heading="打开文件">
          {files.map((f) => (
            <CommandItem
              key={f.id}
              value={f.path}
              onSelect={() => {
                setQuickOpen(false)
                void openFile(f.id)
              }}
            >
              <FileCode2 className="h-4 w-4 text-clay" />
              <span className="truncate font-mono text-[13px]">{f.path}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* 快速打开文件（Ctrl/⌘ + P） */}
      {quickOpenView}
      {/* 命令面板（Ctrl/⌘ + K） */}
      {cmdPaletteView}
      {/* 全局搜索（Ctrl/⌘ + Shift + F） */}
      <GlobalSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onJump={(fileId, line) => void jumpToLine(fileId, line)}
        onJumpToSession={(id) => void switchSession(id)}
      />
      {/* 应用目标选择（代码块「应用到文件…」/ 批量「应用全部」） */}
      <ApplyTargetDialog
        open={applyTargetOpen}
        onOpenChange={(open) => {
          setApplyTargetOpen(open)
          // 用户主动关闭（Esc / 点遮罩）时终止批量队列
          if (!open) setPendingBatch(null)
        }}
        openTabs={openTabs.map((t) => ({ id: t.id, path: t.path }))}
        activeTabId={activeTabId}
        recentMentions={recentMentionIds
          .map((id) => files.find((f) => f.id === id))
          .filter((f): f is FileMeta => !!f)}
        files={files}
        onPick={(fileId) => void pickApplyTarget(fileId)}
        lastTargetId={lastApplyTargetId}
        batchProgress={
          pendingBatch
            ? { current: pendingBatch.idx + 1, total: pendingBatch.codes.length }
            : undefined
        }
      />
      {/* 应用代码前的 diff 预览确认 */}
      <DiffDialog
        open={!!diffState}
        onOpenChange={(open) => {
          if (!open) {
            setDiffState(null)
            // diff 阶段取消同样终止批量队列
            setPendingBatch(null)
          }
        }}
        filePath={diffState?.file.path ?? ''}
        original={diffState?.original ?? ''}
        incoming={diffState?.code ?? ''}
        onConfirm={confirmDiff}
        batchProgress={
          pendingBatch
            ? { current: pendingBatch.idx + 1, total: pendingBatch.codes.length }
            : undefined
        }
      />
      {/* 代码块存为新文件 */}
      <SaveAsDialog
        open={!!saveAsState}
        onOpenChange={(open) => !open && !savingAs && setSaveAsState(null)}
        suggestedName={saveAsState?.suggested ?? ''}
        creating={savingAs}
        onConfirm={(path) => void confirmSaveAs(path)}
      />
      {/* 快捷键帮助（Ctrl/⌘ + /） */}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* 转到行（Ctrl/⌘ + G） */}
      <Dialog open={gotoOpen} onOpenChange={setGotoOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="font-claude-serif">转到行</DialogTitle>
            <DialogDescription>
              定位到 <span className="font-medium">{activeTabRef.current?.path ?? '当前文件'}</span> 的指定行，回车确认
            </DialogDescription>
          </DialogHeader>
          <Input
            value={gotoValue}
            onChange={(e) => setGotoValue(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="行号，如 42"
            inputMode="numeric"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleGotoLine()
            }}
          />
        </DialogContent>
      </Dialog>
      {/* 顶栏 */}
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border bg-card px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-clay">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="font-claude-serif truncate text-[15px] font-semibold leading-tight">
            Claude 风格 AI 编程工作台
          </h1>
          <p className="hidden text-[11px] leading-tight text-muted-foreground sm:block">
            类 Cline / Claude Code · 文件树 + 编辑器 + AI 对话
          </p>
        </div>
        <a
          href="/api/export"
          download
          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="导出项目为 ZIP"
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">导出</span>
        </a>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="在 GitHub 上查看源码"
        >
          <Github className="h-4 w-4" />
          <span className="hidden sm:inline">GitHub</span>
        </a>
        <button
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          title={themeMounted && resolvedTheme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          aria-label="切换深浅色模式"
        >
          {themeMounted && resolvedTheme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>
        {!isMobile && (
          <>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={toggleLeftPanel}
              title={leftCollapsed ? '展开文件树（Ctrl/⌘ + B）' : '折叠文件树（Ctrl/⌘ + B）'}
              aria-label={leftCollapsed ? '展开文件树' : '折叠文件树'}
              aria-pressed={leftCollapsed}
            >
              {leftCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={toggleRightPanel}
              title={rightCollapsed ? '展开 AI 对话（Ctrl/⌘ + Alt + B）' : '折叠 AI 对话（Ctrl/⌘ + Alt + B）'}
              aria-label={rightCollapsed ? '展开 AI 对话面板' : '折叠 AI 对话面板'}
              aria-pressed={rightCollapsed}
            >
              {rightCollapsed ? (
                <PanelRightOpen className="h-4 w-4" />
              ) : (
                <PanelRightClose className="h-4 w-4" />
              )}
            </button>
          </>
        )}
        <button
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setShortcutsOpen(true)}
          title="快捷键帮助（Ctrl/⌘ + /）"
        >
          <Keyboard className="h-4 w-4" />
          <span className="hidden sm:inline">快捷键</span>
        </button>
      </header>

      {initialLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-clay" /> 正在加载工作台…
        </div>
      ) : isMobile ? (
        /* 移动端：Tab 切换三栏（受控，选区 AI 操作时自动切到对话） */
        <Tabs value={mobileTab} onValueChange={setMobileTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-3 mt-2 grid grid-cols-3">
            <TabsTrigger value="files" className="text-xs">文件</TabsTrigger>
            <TabsTrigger value="editor" className="text-xs">编辑器</TabsTrigger>
            <TabsTrigger value="chat" className="text-xs">AI 对话</TabsTrigger>
          </TabsList>
          <TabsContent value="files" className="min-h-0 flex-1 overflow-hidden">
            {fileTreeView}
          </TabsContent>
          <TabsContent value="editor" className="min-h-0 flex-1 overflow-hidden">
            {editorView}
          </TabsContent>
          <TabsContent value="chat" className="min-h-0 flex-1 overflow-hidden">
            {chatView}
          </TabsContent>
        </Tabs>
      ) : (
        /* 桌面端：可拖拽三栏（左右面板可折叠，手柄常驻可拖拽恢复，展开恢复原尺寸） */
        <PanelGroup direction="horizontal" className="flex-1" autoSaveId="workspace-panels">
          <Panel
            ref={leftPanelRef}
            defaultSize={19}
            minSize={13}
            collapsible
            collapsedSize={0}
            className="bg-secondary/40"
            onCollapse={() => setLeftCollapsed(true)}
            onExpand={() => setLeftCollapsed(false)}
          >
            {fileTreeView}
          </Panel>
          <PanelResizeHandle className="w-px bg-border transition-colors data-[resize-handle-state=hover]:bg-clay data-[resize-handle-state=drag]:bg-clay" />
          <Panel defaultSize={46} minSize={25}>
            {editorView}
          </Panel>
          <PanelResizeHandle className="w-px bg-border transition-colors data-[resize-handle-state=hover]:bg-clay data-[resize-handle-state=drag]:bg-clay" />
          <Panel
            ref={rightPanelRef}
            defaultSize={35}
            minSize={22}
            collapsible
            collapsedSize={0}
            className="bg-secondary/20"
            onCollapse={() => setRightCollapsed(true)}
            onExpand={() => setRightCollapsed(false)}
          >
            {chatView}
          </Panel>
        </PanelGroup>
      )}
    </div>
  )
}
