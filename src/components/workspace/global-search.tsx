'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { FileCode2, Loader2, MessageSquareText, Search, TextSearch } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface SearchMatch {
  line: number
  text: string
}

interface SearchResultItem {
  id: string
  path: string
  language: string
  matches: SearchMatch[]
  matchCount: number
  pathMatch: boolean
}

/** 跨会话消息搜索的命中条目 */
interface MessageSearchItem {
  messageId: string
  sessionId: string
  sessionTitle: string
  role: string
  snippet: string
  matchCount: number
  createdAt: string
}

interface GlobalSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 点击命中行：打开文件并跳转到该行 */
  onJump: (fileId: string, line: number) => void
  /** 点击命中消息：切换到对应会话并定位高亮该消息 */
  onJumpToSession: (sessionId: string, messageId?: string) => void
}

/** 把文本按关键词（大小写不敏感）切段，命中段用 <mark> clay 底色标出 */
function highlightParts(text: string, q: string): { t: string; hit: boolean }[] {
  if (!q) return [{ t: text, hit: false }]
  const parts: { t: string; hit: boolean }[] = []
  const lower = text.toLowerCase()
  const lq = q.toLowerCase()
  let i = 0
  while (i < text.length) {
    const idx = lower.indexOf(lq, i)
    if (idx === -1) {
      parts.push({ t: text.slice(i), hit: false })
      break
    }
    if (idx > i) parts.push({ t: text.slice(i, idx), hit: false })
    parts.push({ t: text.slice(idx, idx + q.length), hit: true })
    i = idx + q.length
  }
  return parts
}

function Marked({ text, q }: { text: string; q: string }) {
  const parts = useMemo(() => highlightParts(text, q), [text, q])
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-[3px] bg-clay/20 px-0.5 text-foreground">
            {p.t}
          </mark>
        ) : (
          <span key={i}>{p.t}</span>
        )
      )}
    </>
  )
}

/** 键盘导航的扁平条目：与渲染顺序一致（文件命中行 → 文件名匹配 → 对话消息） */
type SearchPickEntry =
  | { kind: 'file'; fileId: string; line: number }
  | { kind: 'message'; sessionId: string; messageId: string }

export function GlobalSearch({ open, onOpenChange, onJump, onJumpToSession }: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [msgResults, setMsgResults] = useState<MessageSearchItem[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 打开时聚焦并重置焦点状态（保留上次结果，便于连续跳转）
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // 300ms 防抖搜索
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const q = query.trim()
    if (!q) {
      setResults([])
      setMsgResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    timerRef.current = setTimeout(async () => {
      try {
        // 文件与消息两个接口并行请求，互不阻塞（单个失败不影响另一边保留旧结果）
        const [fileRes, msgRes] = await Promise.allSettled([
          fetch(`/api/search?q=${encodeURIComponent(q)}`),
          fetch(`/api/search/messages?q=${encodeURIComponent(q)}`),
        ])
        if (fileRes.status === 'fulfilled' && fileRes.value.ok) {
          const data = await fileRes.value.json()
          setResults(data.results ?? [])
        }
        if (msgRes.status === 'fulfilled' && msgRes.value.ok) {
          const data = await msgRes.value.json()
          setMsgResults(data.results ?? [])
        }
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query])

  const pick = (fileId: string, line: number) => {
    onOpenChange(false)
    onJump(fileId, line)
  }

  const pickMessage = (sessionId: string, messageId: string) => {
    onOpenChange(false)
    onJumpToSession(sessionId, messageId)
  }

  const trimmed = query.trim()

  // 键盘导航：↑↓ 在结果间移动，Enter 打开当前项（顺序与渲染一致）
  const entries = useMemo<SearchPickEntry[]>(() => {
    const list: SearchPickEntry[] = []
    for (const item of results) {
      if (item.matches.length === 0) {
        list.push({ kind: 'file', fileId: item.id, line: 1 })
        continue
      }
      for (const m of item.matches) list.push({ kind: 'file', fileId: item.id, line: m.line })
    }
    for (const msg of msgResults) {
      list.push({ kind: 'message', sessionId: msg.sessionId, messageId: msg.messageId })
    }
    return list
  }, [results, msgResults])
  const [activeIdx, setActiveIdx] = useState(0)
  const clamped = Math.min(activeIdx, Math.max(0, entries.length - 1))
  // 关键词变化时复位到第一条；活动项变化时滚动进可视区
  useEffect(() => {
    setActiveIdx(0)
  }, [query])
  useEffect(() => {
    document
      .querySelector(`[data-search-idx="${clamped}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [clamped])
  const runPick = (en: SearchPickEntry | undefined) => {
    if (!en) return
    if (en.kind === 'file') pick(en.fileId, en.line)
    else pickMessage(en.sessionId, en.messageId)
  }

  // 行键 → 扁平条目序号（与 entries 顺序一致；活动行高亮与滚动定位用）
  const idxMap = useMemo(() => {
    const map = new Map<string, number>()
    let i = 0
    for (const item of results) {
      if (item.matches.length === 0) {
        map.set(`${item.id}:open`, i++)
        continue
      }
      for (const m of item.matches) map.set(`${item.id}:${m.line}`, i++)
    }
    for (const msg of msgResults) map.set(`msg:${msg.messageId}`, i++)
    return map
  }, [results, msgResults])
  const rowCls = (idx: number | undefined, extra?: string) =>
    cn(
      'flex w-full items-baseline gap-2 rounded-md px-2 py-1 pl-6 text-left transition-colors hover:bg-accent',
      idx !== undefined && idx === clamped && 'bg-clay/10',
      extra
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>全局搜索</DialogTitle>
          <DialogDescription>在所有文件的文件名、内容与对话消息中搜索</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActiveIdx((i) => Math.min(i + 1, entries.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActiveIdx((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                runPick(entries[clamped])
              }
            }}
            placeholder="搜索文件名、内容与会话消息…（↑↓ 选择，Enter 打开）"
            className="h-8 border-0 bg-transparent px-0 text-[14px] shadow-none focus-visible:ring-0"
          />
          {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-clay" />}
          {trimmed && !searching && (
            <kbd className="shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {results.length} 个文件
              {msgResults.length > 0 ? ` · ${msgResults.length} 条消息` : ''}
            </kbd>
          )}
        </div>

        <div className="thin-scrollbar max-h-[55vh] overflow-y-auto p-1.5">
          {!trimmed && (
            <div className="flex flex-col items-center gap-1.5 py-10 text-center text-muted-foreground">
              <TextSearch className="h-6 w-6 text-clay/50" />
              <p className="text-[13px]">输入关键词，搜索文件内容与对话消息</p>
              <p className="text-[11px]">支持跳转到具体行 · Ctrl/⌘ + Shift + F</p>
            </div>
          )}

          {trimmed && !searching && results.length === 0 && msgResults.length === 0 && (
            <p className="py-10 text-center text-[13px] text-muted-foreground">
              没有匹配「{trimmed}」的文件、内容或消息
            </p>
          )}

          {results.map((item) => (
            <div key={item.id} className="mb-1">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-clay" />
                <span className="truncate font-mono text-[12.5px] font-medium">
                  <Marked text={item.path} q={trimmed} />
                </span>
                <span className="ml-auto shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                  {item.matches.length > 0 ? `${item.matchCount} 处匹配` : '文件名匹配'}
                </span>
              </div>
              {item.matches.map((match) => {
                const idx = idxMap.get(`${item.id}:${match.line}`)
                return (
                  <button
                    key={match.line}
                    data-search-idx={idx}
                    className={rowCls(idx)}
                    onClick={() => pick(item.id, match.line)}
                  >
                    <span className="w-8 shrink-0 text-right font-mono text-[10.5px] text-muted-foreground">
                      {match.line}
                    </span>
                    <span className="truncate font-mono text-[12px] text-foreground/80">
                      <Marked text={match.text || '（空行）'} q={trimmed} />
                    </span>
                  </button>
                )
              })}
              {item.matches.length === 0 && (() => {
                const idx = idxMap.get(`${item.id}:open`)
                return (
                  <button
                    data-search-idx={idx}
                    className={rowCls(idx)}
                    onClick={() => pick(item.id, 1)}
                  >
                    <span className="text-[12px] text-muted-foreground">打开文件</span>
                  </button>
                )
              })()}
              {item.matchCount > item.matches.length && (
                <p className="px-2 py-1 pl-6 text-[11px] text-muted-foreground">
                  还有 {item.matchCount - item.matches.length} 处匹配未显示
                </p>
              )}
            </div>
          ))}

          {msgResults.length > 0 && (
            <div className="mt-2 mb-1">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-clay" />
                <span className="text-[11px] font-medium text-muted-foreground">对话消息</span>
              </div>
              {msgResults.map((msg) => {
                const idx = idxMap.get(`msg:${msg.messageId}`)
                return (
                  <button
                    key={msg.messageId}
                    data-search-idx={idx}
                    className={cn(
                      rowCls(idx),
                      'flex-col gap-0.5 py-1.5'
                    )}
                    onClick={() => pickMessage(msg.sessionId, msg.messageId)}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium">
                        <Marked text={msg.sessionTitle} q={trimmed} />
                      </span>
                      <span className="shrink-0 rounded-full bg-secondary px-1.5 py-px text-[10px] text-muted-foreground">
                        {msg.role === 'user' ? '用户' : 'AI'}
                      </span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                        {msg.matchCount} 处
                      </span>
                    </span>
                    <span className="line-clamp-2 text-left text-[11.5px] leading-relaxed text-muted-foreground">
                      <Marked text={msg.snippet} q={trimmed} />
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
