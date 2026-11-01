'use client'

import { useEffect, useRef, useState } from 'react'
import { History, Loader2, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/** 快照来源 → 展示文案与配色 */
const SOURCE_LABEL: Record<string, { label: string; className: string }> = {
  manual: { label: '手动保存', className: 'bg-muted text-muted-foreground' },
  ai: { label: 'AI 应用', className: 'bg-clay/10 text-clay' },
  rollback: { label: '回滚', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
}

interface VersionMeta {
  id: string
  source: string
  size: number
  createdAt: string
}

/** 字节数 → 人读尺寸 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 时间 → 相对描述（列表时间轴用绝对时间辅助） */
function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatAbsolute(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 预览最多展示的行数 */
const PREVIEW_LINES = 80

interface VersionHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileId: string
  filePath: string
  /** 当前编辑器实时内容（展开预览时提示「与当前内容一致」） */
  currentContent: string
  /** 执行回滚：写入历史内容并同步编辑器，返回是否成功 */
  onRollback: (fileId: string, content: string) => Promise<boolean>
}

/** 文件历史版本：每次内容变更（手动保存 / AI 应用 / 回滚）自动快照，可预览与一键回滚 */
export function VersionHistoryDialog({
  open,
  onOpenChange,
  fileId,
  filePath,
  currentContent,
  onRollback,
}: VersionHistoryDialogProps) {
  const [versions, setVersions] = useState<VersionMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  /** 已拉取内容的版本缓存（id → content） */
  const contentCacheRef = useRef(new Map<string, string>())
  const [previewLoading, setPreviewLoading] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)

  // 打开时拉取历史列表；切换文件清空展开态与缓存
  useEffect(() => {
    if (!open || !fileId) return
    let cancelled = false
    setLoading(true)
    setExpandedId(null)
    contentCacheRef.current.clear()
    ;(async () => {
      try {
        const res = await fetch(`/api/files/${fileId}/versions`)
        const data = await res.json()
        if (!cancelled && res.ok) setVersions(data.versions ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, fileId])

  /** 展开 / 收起一个版本：首次展开拉取内容并缓存 */
  const toggleExpand = async (v: VersionMeta) => {
    if (expandedId === v.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(v.id)
    if (contentCacheRef.current.has(v.id)) return
    setPreviewLoading(true)
    try {
      const res = await fetch(`/api/files/${fileId}/versions?versionId=${v.id}`)
      const data = await res.json()
      if (res.ok) contentCacheRef.current.set(v.id, data.version?.content ?? '')
    } finally {
      setPreviewLoading(false)
    }
  }

  /** 回滚：交给页面层写入（source=rollback 自动产生新快照，形成完整轨迹） */
  const handleRollback = async (v: VersionMeta) => {
    const content = contentCacheRef.current.get(v.id)
    if (typeof content !== 'string') return
    setRollingBack(true)
    try {
      const ok = await onRollback(fileId, content)
      if (ok) onOpenChange(false)
    } finally {
      setRollingBack(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-claude-serif">
            <History className="h-4.5 w-4.5 text-clay" />
            历史版本
          </DialogTitle>
          <DialogDescription className="truncate">
            {filePath} · 每次内容变更自动生成快照（最多保留 50 条）
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-96 min-h-40 overflow-y-auto pr-1" data-testid="version-list">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : versions.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              暂无历史版本
              <br />
              <span className="text-xs">保存文件或 AI 应用代码后自动生成快照</span>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {versions.map((v) => {
                const expanded = expandedId === v.id
                const content = contentCacheRef.current.get(v.id)
                const sameAsCurrent = typeof content === 'string' && content === currentContent
                const source = SOURCE_LABEL[v.source] ?? SOURCE_LABEL.manual
                return (
                  <li
                    key={v.id}
                    className="rounded-lg border border-border/60 bg-white/60 dark:bg-zinc-900/60"
                  >
                    <button
                      type="button"
                      onClick={() => void toggleExpand(v)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-clay/5"
                      aria-expanded={expanded}
                    >
                      {expanded ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${source.className}`}
                      >
                        {source.label}
                      </span>
                      <span className="text-xs text-muted-foreground" title={formatAbsolute(v.createdAt)}>
                        {formatRelative(v.createdAt)}
                      </span>
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatSize(v.size)}
                      </span>
                    </button>
                    {expanded && (
                      <div className="px-3 pb-3">
                        {previewLoading ? (
                          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 读取内容…
                          </div>
                        ) : (
                          <>
                            <pre className="max-h-60 overflow-auto rounded-md border border-border/60 bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/90">
                              {typeof content === 'string'
                                ? content
                                    .split('\n')
                                    .slice(0, PREVIEW_LINES)
                                    .join('\n') +
                                  (content.split('\n').length > PREVIEW_LINES
                                    ? `\n… 共 ${content.split('\n').length.toLocaleString()} 行`
                                    : '')
                                : ''}
                            </pre>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              {sameAsCurrent ? (
                                <span className="text-xs text-muted-foreground">
                                  该快照与当前内容一致
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  回滚后文件将替换为该快照内容
                                </span>
                              )}
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={sameAsCurrent || rollingBack}
                                onClick={() => void handleRollback(v)}
                                data-testid="rollback-btn"
                              >
                                {rollingBack ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                )}
                                回滚到此版本
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
