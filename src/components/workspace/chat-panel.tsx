'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Eraser,
  Loader2,
  MessageSquarePlus,
  Pencil,
  SendHorizonal,
  Sparkles,
  Square,
  Trash2,
  User,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { AiMessage } from '@/components/workspace/ai-message'
import type { ChatMsg, SessionMeta } from '@/lib/types'

interface ChatPanelProps {
  messages: ChatMsg[]
  loading: boolean
  streamingId: string | null
  activeFilePath: string | null
  sessions: SessionMeta[]
  activeSessionId: string | null
  onSwitchSession: (id: string) => void
  onCreateSession: () => void
  onRenameSession: (id: string, title: string) => Promise<boolean>
  onDeleteSession: (id: string) => void
  onSend: (message: string) => void
  onStop: () => void
  onClear: () => void
  onApplyCode: (code: string) => void
}

const QUICK_ACTIONS = [
  { label: '解释当前文件', prompt: '请逐段解释当前文件的作用，并指出可改进之处。' },
  { label: '优化当前文件', prompt: '请优化当前文件的代码质量、可读性与性能，给出完整的优化后代码。' },
  { label: '修复 Bug', prompt: '请检查当前文件中的潜在 Bug 并给出修复后的完整代码。' },
]

export function ChatPanel({
  messages,
  loading,
  streamingId,
  activeFilePath,
  sessions,
  activeSessionId,
  onSwitchSession,
  onCreateSession,
  onRenameSession,
  onDeleteSession,
  onSend,
  onStop,
  onClear,
  onApplyCode,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<SessionMeta | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SessionMeta | null>(null)

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, loading, messages[messages.length - 1]?.content])

  const send = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    onSend(trimmed)
    setInput('')
  }

  const isStreaming = (id: string) => id === streamingId

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send(input)
    }
  }

  const handleRename = async () => {
    if (!renameTarget || !renameTitle.trim()) return
    setRenaming(true)
    const ok = await onRenameSession(renameTarget.id, renameTitle.trim())
    setRenaming(false)
    if (ok) setRenameTarget(null)
  }

  return (
    <div className="flex h-full flex-col">
      {/* 头部：会话切换器 */}
      <div className="flex items-center gap-1.5 border-b border-border bg-card px-3 py-2">
        <Sparkles className="h-4 w-4 shrink-0 text-clay" />
        <Popover open={sessionMenuOpen} onOpenChange={setSessionMenuOpen}>
          <PopoverTrigger asChild>
            <button
              className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent"
              title="切换会话"
            >
              <span className="font-claude-serif truncate text-[14px] font-semibold">
                {activeSession?.title ?? '选择会话'}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {activeSession ? `${activeSession.messageCount} 条` : ''}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-1.5">
            <button
              className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-clay transition-colors hover:bg-accent"
              onClick={() => {
                setSessionMenuOpen(false)
                onCreateSession()
              }}
            >
              <MessageSquarePlus className="h-4 w-4" /> 新建会话
            </button>
            <div className="thin-scrollbar max-h-64 overflow-y-auto">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`group/session flex items-center rounded-md pr-0.5 transition-colors ${
                    session.id === activeSessionId ? 'bg-clay/10' : 'hover:bg-accent'
                  }`}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-[13px]"
                    onClick={() => {
                      setSessionMenuOpen(false)
                      onSwitchSession(session.id)
                    }}
                  >
                    {session.id === activeSessionId ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-clay" />
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span
                      className={`truncate ${
                        session.id === activeSessionId
                          ? 'font-medium text-clay'
                          : 'text-foreground/85'
                      }`}
                    >
                      {session.title}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {session.messageCount} 条
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/session:opacity-100">
                    <button
                      className="flex h-6 w-6 items-center justify-center rounded hover:bg-background"
                      title="重命名"
                      onClick={() => {
                        setRenameTarget(session)
                        setRenameTitle(session.title)
                      }}
                    >
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </button>
                    <button
                      className="flex h-6 w-6 items-center justify-center rounded hover:bg-background"
                      title="删除会话"
                      onClick={() => setDeleteTarget(session)}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7 shrink-0"
          onClick={() => {
            setSessionMenuOpen(false)
            onCreateSession()
          }}
          disabled={loading}
          aria-label="新建会话"
          title="新建会话"
        >
          <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onClear}
          disabled={loading}
          aria-label="清空当前会话对话"
          title="清空当前会话对话"
        >
          <Eraser className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>

      {/* 消息列表 */}
      <div className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {messages.length === 0 && !loading && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Sparkles className="h-6 w-6 text-clay/60" />
            <p className="font-claude-serif text-sm text-foreground/70">开始新的对话</p>
            <p className="max-w-[220px] text-xs text-muted-foreground">
              向 AI 描述需求，或打开文件后使用下方快捷指令
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className="flex gap-2.5">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                msg.role === 'assistant' ? 'bg-clay/12' : 'bg-secondary'
              }`}
            >
              {msg.role === 'assistant' ? (
                <Sparkles className="h-3.5 w-3.5 text-clay" />
              ) : (
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </div>
            <div
              className={`min-w-0 max-w-[calc(100%-42px)] rounded-xl px-3 py-2 ${
                msg.role === 'assistant'
                  ? 'bg-card text-foreground'
                  : 'bg-clay/10 text-foreground'
              }`}
            >
              {msg.role === 'assistant' ? (
                <AiMessage
                  content={
                    isStreaming(msg.id)
                      ? msg.content + (msg.content ? ' ▍' : '▍')
                      : msg.content
                  }
                  onApplyCode={isStreaming(msg.id) ? undefined : onApplyCode}
                  applyDisabled={!activeFilePath}
                />
              ) : (
                <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">
                  {msg.content}
                </p>
              )}
            </div>
          </div>
        ))}

        {loading && !messages.some((m) => isStreaming(m.id)) && (
          <div className="flex gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-clay/12">
              <Sparkles className="h-3.5 w-3.5 text-clay" />
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-card px-3 py-2.5 text-[13px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-clay" />
              正在思考…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 快捷指令 */}
      <div className="flex flex-wrap gap-1.5 px-3 pb-2">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            className="rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] text-foreground/75 transition-colors hover:border-clay/50 hover:text-clay disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => send(action.prompt)}
            disabled={loading || !activeFilePath}
            title={activeFilePath ? action.prompt : '请先打开一个文件'}
          >
            {action.label}
          </button>
        ))}
      </div>

      {/* 输入区 */}
      <div className="px-3 pb-3">
        <div className="relative rounded-xl border border-border bg-card shadow-sm transition-colors focus-within:border-clay/60">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeFilePath
                ? `询问 AI，或让它修改 ${activeFilePath}…（Enter 发送，Shift+Enter 换行）`
                : '向 AI 描述你的需求…（打开文件后可针对文件提问）'
            }
            className="min-h-[72px] resize-none border-0 bg-transparent pr-12 text-[13.5px] focus-visible:ring-0"
          />
          {loading ? (
            <Button
              size="icon"
              variant="secondary"
              className="absolute bottom-2.5 right-2.5 h-8 w-8 rounded-lg border border-border"
              onClick={onStop}
              aria-label="停止生成"
              title="停止生成"
            >
              <Square className="h-3 w-3 fill-current text-clay" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="absolute bottom-2.5 right-2.5 h-8 w-8 rounded-lg"
              onClick={() => send(input)}
              disabled={!input.trim()}
              aria-label="发送"
            >
              <SendHorizonal className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* 重命名会话 */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-claude-serif">重命名会话</DialogTitle>
          </DialogHeader>
          <Input
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            maxLength={60}
            autoFocus
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>
              取消
            </Button>
            <Button onClick={handleRename} disabled={renaming || !renameTitle.trim()}>
              {renaming && <Loader2 className="h-4 w-4 animate-spin" />} 保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除会话确认 */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-claude-serif">删除会话？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除「{deleteTarget?.title}」及其全部对话记录，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                if (deleteTarget) onDeleteSession(deleteTarget.id)
                setDeleteTarget(null)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
