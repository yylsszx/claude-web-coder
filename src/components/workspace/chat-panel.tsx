'use client'

import { useEffect, useRef, useState } from 'react'
import { Eraser, Loader2, SendHorizonal, Sparkles, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AiMessage } from '@/components/workspace/ai-message'
import type { ChatMsg } from '@/lib/types'

interface ChatPanelProps {
  messages: ChatMsg[]
  loading: boolean
  streamingId: string | null
  activeFilePath: string | null
  onSend: (message: string) => void
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
  onSend,
  onClear,
  onApplyCode,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

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

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2.5">
        <Sparkles className="h-4 w-4 text-clay" />
        <h2 className="font-claude-serif text-[15px] font-semibold">AI 助手</h2>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7"
          onClick={onClear}
          disabled={loading}
          aria-label="清空对话"
          title="清空对话"
        >
          <Eraser className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>

      {/* 消息列表 */}
      <div className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
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

        {loading && (
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
          <Button
            size="icon"
            className="absolute bottom-2.5 right-2.5 h-8 w-8 rounded-lg"
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            aria-label="发送"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizonal className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
