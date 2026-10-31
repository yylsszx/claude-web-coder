'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Github, Sparkles, Loader2 } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { useIsMobile } from '@/hooks/use-mobile'
import { FileTree } from '@/components/workspace/file-tree'
import { CodeEditor, type SaveState } from '@/components/workspace/code-editor'
import { ChatPanel } from '@/components/workspace/chat-panel'
import type { ChatMsg, FileFull, FileMeta } from '@/lib/types'

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
  const [chatLoading, setChatLoading] = useState(false)
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)

  const activeTab = useMemo(
    () => openTabs.find((t) => t.id === activeTabId) ?? null,
    [openTabs, activeTabId]
  )

  // refs：异步回调中读取最新值
  const openTabsRef = useRef(openTabs)
  openTabsRef.current = openTabs
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // ===== 初始加载 =====
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [filesRes, chatRes] = await Promise.all([
          fetch('/api/files'),
          fetch('/api/chat'),
        ])
        const filesData = await filesRes.json()
        const chatData = await chatRes.json()
        if (cancelled) return
        if (filesRes.ok) setFiles(filesData.files ?? [])
        if (chatRes.ok) setMessages(chatData.messages ?? [])
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

  // Ctrl/⌘ + S 手动保存当前标签
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

  // ===== 聊天（流式） =====
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

      const tab = activeTabRef.current
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
          body: JSON.stringify({
            message,
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
        let doneIds: { userMessageId: string; assistantMessageId: string } | null = null

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
        }
      } catch (error) {
        // 丢弃占位消息（含未完成的流式内容），提示错误
        if (flushTimer) clearTimeout(flushTimer)
        setMessages((prev) =>
          prev.filter((m) => m.id !== streamId && m.id !== tempUserId)
        )
        toast({
          title: 'AI 调用失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        })
      } finally {
        setChatLoading(false)
        setStreamingId(null)
      }
    },
    [toast]
  )

  const clearChat = useCallback(async () => {
    try {
      const res = await fetch('/api/chat', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '清空失败')
      setMessages(data.messages ?? [])
    } catch (error) {
      toast({
        title: '清空失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        variant: 'destructive',
      })
    }
  }, [toast])

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

  // ===== 视图 =====
  const fileTreeView = (
    <FileTree
      files={files}
      activeId={activeTabId}
      onOpen={openFile}
      onCreate={createFile}
      onRename={renameFile}
      onDelete={deleteFile}
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
      onSend={sendMessage}
      onClear={clearChat}
      onApplyCode={applyCode}
    />
  )

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
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
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
