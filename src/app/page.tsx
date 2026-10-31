'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Github, Sparkles, Loader2, FileCode2, Search, Download } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { useIsMobile } from '@/hooks/use-mobile'
import { FileTree } from '@/components/workspace/file-tree'
import { CodeEditor, type JumpTarget, type SaveState } from '@/components/workspace/code-editor'
import { ChatPanel } from '@/components/workspace/chat-panel'
import { GlobalSearch } from '@/components/workspace/global-search'
import type { ChatMsg, FileFull, FileMeta, SessionMeta } from '@/lib/types'

const REPO_URL = 'https://github.com/yylsszx/claude-web-coder'

export default function WorkspacePage() {
  const { toast } = useToast()
  const isMobile = useIsMobile()

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
  const [searchOpen, setSearchOpen] = useState(false)
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null)

  const activeTab = useMemo(
    () => openTabs.find((t) => t.id === activeTabId) ?? null,
    [openTabs, activeTabId]
  )

  // refs：异步回调中读取最新值
  const openTabsRef = useRef(openTabs)
  openTabsRef.current = openTabs
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const activeSessionRef = useRef(activeSessionId)
  activeSessionRef.current = activeSessionId
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const abortRef = useRef<AbortController | null>(null)

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

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error ?? '删除失败')
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

  // ===== 保存 =====
  const saveTab = useCallback(
    async (tabId: string, contentOverride?: string) => {
      const tab = openTabsRef.current.find((t) => t.id === tabId)
      if (!tab) return
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
      } catch (error) {
        setTabStates((prev) => ({ ...prev, [tabId]: 'dirty' }))
        toast({
          title: '保存失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        })
      }
    },
    [toast]
  )

  const scheduleSave = useCallback(
    (tabId: string, content: string) => {
      if (saveTimersRef.current[tabId]) clearTimeout(saveTimersRef.current[tabId])
      saveTimersRef.current[tabId] = setTimeout(() => void saveTab(tabId, content), 1000)
    },
    [saveTab]
  )

  // Ctrl/⌘ + P 快速打开；Ctrl/⌘ + Shift + F 全局搜索；Ctrl/⌘ + S 手动保存当前标签
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
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
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveTab])

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

  // ===== 聊天（流式，支持停止生成） =====
  const sendMessage = useCallback(
    async (message: string) => {
      const tempUserId = `tmp-u-${Date.now()}`
      const streamId = `tmp-a-${Date.now()}`
      const now = new Date().toISOString()
      setMessages((prev) => [
        ...prev,
        { id: tempUserId, role: 'user', content: message, createdAt: now },
        { id: streamId, role: 'assistant', content: '', createdAt: now },
      ])
      setChatLoading(true)
      setStreamingId(streamId)

      const controller = new AbortController()
      abortRef.current = controller

      const tab = activeTabRef.current
      const sessionId = activeSessionRef.current
      let pending = ''
      let flushTimer: ReturnType<typeof setTimeout> | null = null
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
            currentFile: tab
              ? { path: tab.path, content: tab.content, language: tab.language }
              : null,
          }),
        })
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? 'AI 调用失败')
        }

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
                ? { ...m, id: ids.assistantMessageId }
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
        } else {
          // 真实错误：丢弃占位消息，提示错误
          setMessages((prev) =>
            prev.filter((m) => m.id !== streamId && m.id !== tempUserId)
          )
          toast({
            title: 'AI 调用失败',
            description: error instanceof Error ? error.message : '请稍后重试',
            variant: 'destructive',
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

  /** 把 AI 代码块应用到当前标签 */
  const applyCode = useCallback(
    (code: string) => {
      const tab = activeTabRef.current
      if (!tab) return
      setOpenTabs((prev) =>
        prev.map((t) => (t.id === tab.id ? { ...t, content: code } : t))
      )
      setTabStates((prev) => ({ ...prev, [tab.id]: 'dirty' }))
      scheduleSave(tab.id, code)
      toast({
        title: '已应用到编辑器',
        description: '代码已写入当前文件，即将自动保存',
      })
    },
    [scheduleSave, toast]
  )

  /** 从全局搜索跳转：打开文件并定位到指定行 */
  const jumpToLine = useCallback(
    async (fileId: string, line: number) => {
      await openFile(fileId)
      setJumpTarget({ fileId, line, nonce: Date.now() })
    },
    [openFile]
  )

  // ===== 视图 =====
  const fileTreeView = (
    <FileTree
      files={files}
      activeId={activeTabId}
      onOpen={openFile}
      onCreate={createFile}
      onRename={renameFile}
      onDelete={deleteFile}
      onQuickOpen={() => setQuickOpen(true)}
    />
  )

  const editorView = (
    <CodeEditor
      tabs={openTabs}
      activeId={activeTabId}
      tabStates={tabStates}
      onSwitchTab={setActiveTabId}
      onCloseTab={closeTab}
      onChange={handleEditorChange}
      jumpTarget={jumpTarget}
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
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSwitchSession={switchSession}
      onCreateSession={createSession}
      onRenameSession={renameSession}
      onDeleteSession={deleteSession}
      onSend={sendMessage}
      onStop={stopGeneration}
      onClear={clearChat}
      onApplyCode={applyCode}
    />
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
      {/* 全局搜索（Ctrl/⌘ + Shift + F） */}
      <GlobalSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onJump={(fileId, line) => void jumpToLine(fileId, line)}
      />
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
      </header>

      {initialLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-clay" /> 正在加载工作台…
        </div>
      ) : isMobile ? (
        /* 移动端：Tab 切换三栏 */
        <Tabs defaultValue="chat" className="flex min-h-0 flex-1 flex-col">
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
        /* 桌面端：可拖拽三栏 */
        <PanelGroup direction="horizontal" className="flex-1" autoSaveId="workspace-panels">
          <Panel defaultSize={19} minSize={13} className="bg-secondary/40">
            {fileTreeView}
          </Panel>
          <PanelResizeHandle className="w-px bg-border transition-colors data-[resize-handle-state=hover]:bg-clay data-[resize-handle-state=drag]:bg-clay" />
          <Panel defaultSize={46} minSize={25}>
            {editorView}
          </Panel>
          <PanelResizeHandle className="w-px bg-border transition-colors data-[resize-handle-state=hover]:bg-clay data-[resize-handle-state=drag]:bg-clay" />
          <Panel defaultSize={35} minSize={22} className="bg-secondary/20">
            {chatView}
          </Panel>
        </PanelGroup>
      )}
    </div>
  )
}
