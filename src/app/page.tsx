'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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

  // ===== 状态 =====
  const [files, setFiles] = useState<FileMeta[]>([])
  const [activeFile, setActiveFile] = useState<FileFull | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)

  // 用 ref 保存最新编辑器内容，避免异步回调拿到旧值
  const editorContentRef = useRef('')
  editorContentRef.current = editorContent

  const activeFileRef = useRef<FileFull | null>(null)
  activeFileRef.current = activeFile

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ===== 数据加载 =====
  const refreshFiles = useCallback(async () => {
    const res = await fetch('/api/files')
    const data = await res.json()
    if (res.ok) setFiles(data.files ?? [])
  }, [])

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
    }
  }, [])

  // ===== 保存 =====
  const saveFile = useCallback(
    async (contentOverride?: string) => {
      const file = activeFileRef.current
      if (!file) return
      const content = contentOverride ?? editorContentRef.current
      setSaveState('saving')
      try {
        const res = await fetch(`/api/files/${file.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error ?? '保存失败')
        }
        setActiveFile((prev) => (prev && prev.id === file.id ? { ...prev, content } : prev))
        setSaveState('saved')
      } catch (error) {
        setSaveState('dirty')
        toast({
          title: '保存失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        })
      }
    },
    [toast]
  )

  const handleEditorChange = useCallback(
    (value: string) => {
      setEditorContent(value)
      setSaveState('dirty')
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => void saveFile(value), 1000)
    },
    [saveFile]
  )

  // Ctrl/⌘ + S 手动保存
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        void saveFile()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveFile])

  // ===== 文件操作 =====
  const openFile = useCallback(
    async (id: string) => {
      if (activeFileRef.current?.id === id) return
      // 切换前先保存未保存的内容
      if (saveState === 'dirty' && saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        await saveFile()
      }
      try {
        const res = await fetch(`/api/files/${id}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? '打开文件失败')
        setActiveFile(data.file)
        setEditorContent(data.file.content)
        setSaveState('saved')
      } catch (error) {
        toast({
          title: '打开文件失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        })
      }
    },
    [saveFile, saveState, toast]
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
        if (activeFileRef.current?.id === id) {
          setActiveFile((prev) => (prev ? { ...prev, path: newPath } : prev))
        }
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
        if (activeFileRef.current?.id === id) {
          setActiveFile(null)
          setEditorContent('')
        }
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
    [refreshFiles, toast]
  )

  // ===== 聊天 =====
  const sendMessage = useCallback(
    async (message: string) => {
      const tempUser: ChatMsg = {
        id: `tmp-${Date.now()}`,
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, tempUser])
      setChatLoading(true)

      const file = activeFileRef.current
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            currentFile: file
              ? { path: file.path, content: editorContentRef.current, language: file.language }
              : null,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'AI 调用失败')
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== tempUser.id),
          data.userMessage,
          data.assistantMessage,
        ])
      } catch (error) {
        setMessages((prev) => prev.filter((m) => m.id !== tempUser.id))
        toast({
          title: 'AI 调用失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        })
      } finally {
        setChatLoading(false)
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

  /** 把 AI 代码块应用到当前文件 */
  const applyCode = useCallback(
    (code: string) => {
      setEditorContent(code)
      setSaveState('dirty')
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => void saveFile(code), 1000)
      toast({
        title: '已应用到编辑器',
        description: '代码已写入当前文件，即将自动保存',
      })
    },
    [saveFile, toast]
  )

  // ===== 视图 =====
  const fileTreeView = (
    <FileTree
      files={files}
      activeId={activeFile?.id ?? null}
      onOpen={openFile}
      onCreate={createFile}
      onRename={renameFile}
      onDelete={deleteFile}
    />
  )

  const editorView = (
    <CodeEditor
      file={activeFile}
      content={editorContent}
      saveState={saveState}
      onChange={handleEditorChange}
      onSave={() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        void saveFile()
      }}
    />
  )

  const chatView = (
    <ChatPanel
      messages={messages}
      loading={chatLoading}
      activeFilePath={activeFile?.path ?? null}
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
