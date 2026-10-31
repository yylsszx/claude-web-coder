'use client'

import { useMemo, useState } from 'react'
import { FileCode2, FileInput, FolderOpen, History, RotateCcw, Search } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { FileMeta } from '@/lib/types'

interface ApplyTargetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 打开的标签（优先展示） */
  openTabs: { id: string; path: string }[]
  /** 当前激活标签 id */
  activeTabId: string | null
  /** 最近一次 @ 引用的文件（从会话记录提取） */
  recentMentions: FileMeta[]
  /** 工作区全部文件 */
  files: FileMeta[]
  /** 选中目标文件 id */
  onPick: (fileId: string) => void
  /** 上次应用目标（置顶提示） */
  lastTargetId?: string | null
}

interface TargetRow {
  file: FileMeta
  badge: string
}

/** 选择 AI 代码的应用目标文件：打开的标签 / 最近 @ 引用 / 工作区全部文件（可过滤） */
export function ApplyTargetDialog({
  open,
  onOpenChange,
  openTabs,
  activeTabId,
  recentMentions,
  files,
  onPick,
  lastTargetId,
}: ApplyTargetDialogProps) {
  const [query, setQuery] = useState('')

  const openTabIds = useMemo(() => new Set(openTabs.map((t) => t.id)), [openTabs])

  /** 候选主列表：按关键词过滤全部文件 */
  const matched = useMemo(() => {
    const q = query.trim().toLowerCase()
    return files.filter((f) => f.path.toLowerCase().includes(q))
  }, [files, query])

  /** 分组：打开的标签在前，其余在后；最近引用单独成一区 */
  const groups = useMemo(() => {
    const opened: TargetRow[] = []
    const others: TargetRow[] = []
    for (const f of matched) {
      if (openTabIds.has(f.id)) {
        opened.push({ file: f, badge: f.id === activeTabId ? '当前' : '已打开' })
      } else {
        others.push({ file: f, badge: '' })
      }
    }
    const mentionIds = new Set(recentMentions.map((m) => m.id))
    const last = files.find((f) => f.id === lastTargetId) ?? null
    return {
      opened,
      others,
      mentions: recentMentions.filter(
        (m) => mentionIds.has(m.id) && files.some((f) => f.id === m.id)
      ),
      last,
    }
  }, [matched, openTabIds, activeTabId, recentMentions, files, lastTargetId])

  const pick = (fileId: string) => {
    onPick(fileId)
    setQuery('')
  }

  const renderRow = (row: TargetRow, icon: React.ReactNode) => (
    <button
      key={row.file.id}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-clay/10"
      onClick={() => pick(row.file.id)}
    >
      {icon}
      <span className="truncate font-mono">{row.file.path}</span>
      {row.badge && (
        <span
          className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${
            row.badge === '当前'
              ? 'bg-clay/15 text-clay'
              : 'bg-secondary text-muted-foreground'
          }`}
        >
          {row.badge}
        </span>
      )}
    </button>
  )

  const empty =
    groups.opened.length === 0 &&
    groups.mentions.length === 0 &&
    groups.others.length === 0 &&
    !groups.last

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setQuery('') }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-claude-serif">
            <FileInput className="h-4 w-4 text-clay" />
            应用到哪个文件？
          </DialogTitle>
          <DialogDescription>
            选择 AI 代码的写入目标，确认前仍可预览 diff
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按路径过滤文件…"
            className="h-8 pl-8 text-[13px]"
            autoFocus
          />
        </div>

        <div className="thin-scrollbar max-h-[46vh] min-h-0 space-y-3 overflow-y-auto pr-0.5">
          {empty && (
            <p className="py-6 text-center text-[13px] text-muted-foreground">
              没有匹配的文件
            </p>
          )}
          {groups.last && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <RotateCcw className="h-3 w-3" /> 上次应用
              </p>
              <div className="space-y-0.5">
                {renderRow(
                  { file: groups.last, badge: '' },
                  <FileCode2 className="h-3.5 w-3.5 shrink-0 text-clay" />
                )}
              </div>
            </div>
          )}
          {groups.opened.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <FolderOpen className="h-3 w-3" /> 打开的标签
              </p>
              <div className="space-y-0.5">
                {groups.opened.map((row) => renderRow(row, <FileCode2 className="h-3.5 w-3.5 shrink-0 text-clay" />))}
              </div>
            </div>
          )}
          {groups.mentions.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <History className="h-3 w-3" /> 最近 @ 引用
              </p>
              <div className="space-y-0.5">
                {groups.mentions.map((m) => renderRow({ file: m, badge: '' }, <FileCode2 className="h-3.5 w-3.5 shrink-0 text-clay" />))}
              </div>
            </div>
          )}
          {groups.others.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <FileCode2 className="h-3 w-3" /> 工作区文件
              </p>
              <div className="space-y-0.5">
                {groups.others.map((row) => renderRow(row, <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
