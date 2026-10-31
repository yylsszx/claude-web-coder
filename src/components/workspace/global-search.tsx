'use client'

import { useEffect, useRef, useState } from 'react'
import { FileCode2, Loader2, Search, TextSearch } from 'lucide-react'
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

interface GlobalSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 点击命中行：打开文件并跳转到该行 */
  onJump: (fileId: string, line: number) => void
}

export function GlobalSearch({ open, onOpenChange, onJump }: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResultItem[]>([])
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
      setSearching(false)
      return
    }
    setSearching(true)
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        if (res.ok) setResults(data.results ?? [])
      } catch {
        // 静默失败：保留上次结果
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

  const trimmed = query.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>全局搜索</DialogTitle>
          <DialogDescription>在所有文件的文件名与内容中搜索</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文件名与内容…"
            className="h-8 border-0 bg-transparent px-0 text-[14px] shadow-none focus-visible:ring-0"
          />
          {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-clay" />}
          {trimmed && !searching && (
            <kbd className="shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {results.length} 个文件
            </kbd>
          )}
        </div>

        <div className="thin-scrollbar max-h-[55vh] overflow-y-auto p-1.5">
          {!trimmed && (
            <div className="flex flex-col items-center gap-1.5 py-10 text-center text-muted-foreground">
              <TextSearch className="h-6 w-6 text-clay/50" />
              <p className="text-[13px]">输入关键词，搜索所有文件的内容</p>
              <p className="text-[11px]">支持跳转到具体行 · Ctrl/⌘ + Shift + F</p>
            </div>
          )}

          {trimmed && !searching && results.length === 0 && (
            <p className="py-10 text-center text-[13px] text-muted-foreground">
              没有匹配「{trimmed}」的文件或内容
            </p>
          )}

          {results.map((item) => (
            <div key={item.id} className="mb-1">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-clay" />
                <span className="truncate font-mono text-[12.5px] font-medium">
                  {item.path}
                </span>
                <span className="ml-auto shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                  {item.matches.length > 0 ? `${item.matchCount} 处匹配` : '文件名匹配'}
                </span>
              </div>
              {item.matches.map((match) => (
                <button
                  key={match.line}
                  className={cn(
                    'group/line flex w-full items-baseline gap-2 rounded-md px-2 py-1 pl-6 text-left transition-colors hover:bg-accent'
                  )}
                  onClick={() => pick(item.id, match.line)}
                >
                  <span className="w-8 shrink-0 text-right font-mono text-[10.5px] text-muted-foreground">
                    {match.line}
                  </span>
                  <span className="truncate font-mono text-[12px] text-foreground/80">
                    {match.text || '（空行）'}
                  </span>
                </button>
              ))}
              {item.matches.length === 0 && (
                <button
                  className="group/line flex w-full items-baseline gap-2 rounded-md px-2 py-1 pl-6 text-left transition-colors hover:bg-accent"
                  onClick={() => pick(item.id, 1)}
                >
                  <span className="text-[12px] text-muted-foreground">打开文件</span>
                </button>
              )}
              {item.matchCount > item.matches.length && (
                <p className="px-2 py-1 pl-6 text-[11px] text-muted-foreground">
                  还有 {item.matchCount - item.matches.length} 处匹配未显示
                </p>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
