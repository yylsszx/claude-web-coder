'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { diffLines } from 'diff'
import {
  History,
  Loader2,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  FileDiff,
  FileCode2,
  GitCompareArrows,
} from 'lucide-react'
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
  rollback: {
    label: '回滚',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
}

interface VersionMeta {
  id: string
  source: string
  size: number
  createdAt: string
}

type DiffRow = { type: 'add' | 'del' | 'same'; text: string }

/** diff 统计：新增 / 删除行数 */
function diffStats(rows: DiffRow[]): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const r of rows) {
    if (r.type === 'add') add++
    else if (r.type === 'del') del++
  }
  return { add, del }
}

/** diffLines 分块展平为行序列（去掉行尾换行，空块过滤） */
function buildDiffRows(version: string, current: string): DiffRow[] {
  const parts = diffLines(version, current)
  const rows: DiffRow[] = []
  for (const part of parts) {
    const type: DiffRow['type'] = part.added ? 'add' : part.removed ? 'del' : 'same'
    const lines = part.value.split('\n')
    // diffLines 的值总是以 \n 结尾，split 后最后一段为空串
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    for (const text of lines) rows.push({ type, text })
  }
  return rows
}

/** 字节数 → 人读尺寸 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 时间 → 相对描述 */
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
/** diff 视图最多渲染的行数（长文件防卡顿） */
const DIFF_MAX_ROWS = 400

interface VersionHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileId: string
  filePath?: string
  /** 执行回滚：写入历史内容并同步编辑器 / 文件树，返回是否成功 */
  onRollback: (fileId: string, content: string) => Promise<boolean>
}

/** 文件历史版本：每次内容变更（手动保存 / AI 应用 / 回滚）自动快照，可预览、与当前对比、一键回滚。
    文件当前内容由组件内部拉取——文件树右键入口对未打开的文件同样可用。 */
export function VersionHistoryDialog({
  open,
  onOpenChange,
  fileId,
  filePath,
  onRollback,
}: VersionHistoryDialogProps) {
  const [versions, setVersions] = useState<VersionMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  /** 展开条目的视图：内容预览 / 与当前对比 / 与上一版对比（相邻快照 diff，看清单步变化） */
  const [viewMode, setViewMode] = useState<'preview' | 'diff-current' | 'diff-prev'>(
    'preview'
  )
  /** 已拉取内容的版本缓存（id → content） */
  const contentCacheRef = useRef(new Map<string, string>())
  const [previewLoading, setPreviewLoading] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  /** 文件当前内容（打开时拉取，供「与当前一致」判断与 diff） */
  const [currentContent, setCurrentContent] = useState<string | null>(null)

  // 打开时拉取历史列表 + 当前文件内容；切换文件清空展开态与缓存
  useEffect(() => {
    if (!open || !fileId) return
    let cancelled = false
    setLoading(true)
    setExpandedId(null)
    setViewMode('preview')
    contentCacheRef.current.clear()
    setCurrentContent(null)
    ;(async () => {
      try {
        const [vRes, fRes] = await Promise.all([
          fetch(`/api/files/${fileId}/versions`),
          fetch(`/api/files/${fileId}`),
        ])
        const vData = await vRes.json()
        if (!cancelled && vRes.ok) setVersions(vData.versions ?? [])
        if (!cancelled && fRes.ok) {
          const fData = await fRes.json()
          setCurrentContent(fData.file?.content ?? '')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, fileId])

  /** 展开 / 收起一个版本：首次展开拉取内容并缓存，顺带预取更早一版（供「与上一版对比」直接可用） */
  const toggleExpand = async (v: VersionMeta) => {
    if (expandedId === v.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(v.id)
    setViewMode('preview')
    setPreviewLoading(true)
    try {
      if (!contentCacheRef.current.has(v.id)) {
        const res = await fetch(`/api/files/${fileId}/versions?versionId=${v.id}`)
        const data = await res.json()
        if (res.ok) contentCacheRef.current.set(v.id, data.version?.content ?? '')
      }
      // 预取时间序上更早的相邻快照（列表下一条），失败静默——按钮禁用兜底
      const idx = versions.findIndex((x) => x.id === v.id)
      const older = idx >= 0 ? versions[idx + 1] : undefined
      if (older && !contentCacheRef.current.has(older.id)) {
        const res2 = await fetch(
          `/api/files/${fileId}/versions?versionId=${older.id}`
        )
        if (res2.ok) {
          const data2 = await res2.json()
          contentCacheRef.current.set(older.id, data2.version?.content ?? '')
        }
      }
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

  /** 展开条目的上一版（列表时间倒序，下一条即更早一版）；首条无上一版 */
  const expandedIndex = versions.findIndex((v) => v.id === expandedId)
  const prevVersion = expandedIndex >= 0 ? versions[expandedIndex + 1] : undefined
  const prevContent = prevVersion ? contentCacheRef.current.get(prevVersion.id) : undefined

  /** 取 diff 基准内容与标签：diff-current 对比当前文件，diff-prev 对比上一版快照 */
  const diffBase =
    viewMode === 'diff-prev'
      ? { content: typeof prevContent === 'string' ? prevContent : null, label: '上一版' }
      : { content: currentContent, label: '当前' }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-claude-serif">
            <History className="h-4.5 w-4.5 text-clay" />
            历史版本
          </DialogTitle>
          <DialogDescription className="truncate">
            {filePath ? `${filePath} · ` : ''}每次内容变更自动生成快照（最多保留 50 条）
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
                const sameAsCurrent =
                  typeof content === 'string' &&
                  currentContent !== null &&
                  content === currentContent
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
                      <span
                        className="text-xs text-muted-foreground"
                        title={formatAbsolute(v.createdAt)}
                      >
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
                        ) : typeof content === 'string' ? (
                          <>
                            {/* 预览 / 对比切换 + diff 统计 */}
                            <div className="mb-1.5 flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setViewMode('preview')}
                                aria-pressed={viewMode === 'preview'}
                                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
                                  viewMode === 'preview'
                                    ? 'bg-clay/10 text-clay'
                                    : 'text-muted-foreground hover:bg-muted'
                                }`}
                              >
                                <FileCode2 className="h-3 w-3" /> 内容
                              </button>
                              <button
                                type="button"
                                onClick={() => setViewMode('diff-current')}
                                aria-pressed={viewMode === 'diff-current'}
                                disabled={currentContent === null}
                                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                  viewMode === 'diff-current'
                                    ? 'bg-clay/10 text-clay'
                                    : 'text-muted-foreground hover:bg-muted'
                                }`}
                              >
                                <FileDiff className="h-3 w-3" /> 与当前对比
                              </button>
                              <button
                                type="button"
                                onClick={() => setViewMode('diff-prev')}
                                aria-pressed={viewMode === 'diff-prev'}
                                disabled={!prevVersion || typeof prevContent !== 'string'}
                                title={
                                  prevVersion
                                    ? `对比 ${formatRelative(prevVersion.createdAt)} 的上一版快照`
                                    : '该快照没有更早的版本（最早一条）'
                                }
                                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                  viewMode === 'diff-prev'
                                    ? 'bg-clay/10 text-clay'
                                    : 'text-muted-foreground hover:bg-muted'
                                }`}
                              >
                                <GitCompareArrows className="h-3 w-3" /> 与上一版对比
                              </button>
                              {viewMode !== 'preview' && diffBase.content !== null && (
                                <DiffStatsBadge version={content} base={diffBase.content} />
                              )}
                            </div>
                            {viewMode === 'preview' ? (
                              <pre className="max-h-60 overflow-auto rounded-md border border-border/60 bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/90">
                                {content.split('\n').slice(0, PREVIEW_LINES).join('\n') +
                                  (content.split('\n').length > PREVIEW_LINES
                                    ? `\n… 共 ${content.split('\n').length.toLocaleString()} 行`
                                    : '')}
                              </pre>
                            ) : diffBase.content !== null ? (
                              <DiffView
                                version={content}
                                base={diffBase.content}
                                same={diffBase.content === content}
                                baseLabel={diffBase.label}
                              />
                            ) : null}
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
                        ) : null}
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

/** diff 统计徽标：+新增 / -删除 行数（base 为对比基准：当前内容或上一版快照） */
function DiffStatsBadge({ version, base }: { version: string; base: string }) {
  const stats = useMemo(
    () => diffStats(buildDiffRows(version, base)),
    [version, base]
  )
  if (stats.add === 0 && stats.del === 0) {
    return <span className="text-[11px] text-muted-foreground">无差异</span>
  }
  return (
    <span className="text-[11px] tabular-nums">
      <span className="font-medium text-green-600">+{stats.add}</span>{' '}
      <span className="font-medium text-red-600">-{stats.del}</span>
    </span>
  )
}

/** 紧凑行级 diff 视图：新增绿 / 删除红，超长截断提示 */
function DiffView({
  version,
  base,
  same,
  baseLabel,
}: {
  version: string
  base: string
  same: boolean
  baseLabel: string
}) {
  const rows = useMemo(() => buildDiffRows(version, base), [version, base])
  if (same) {
    return (
      <div className="rounded-md border border-border/60 bg-muted/40 px-2.5 py-3 text-xs text-muted-foreground">
        快照与{baseLabel}内容完全一致
      </div>
    )
  }
  const truncated = rows.length > DIFF_MAX_ROWS
  const shown = truncated ? rows.slice(0, DIFF_MAX_ROWS) : rows
  return (
    <div
      className="max-h-60 overflow-auto rounded-md border border-border/60 bg-muted/40 p-1.5 font-mono text-[11px] leading-relaxed"
      data-testid="version-diff"
    >
      {shown.map((r, i) => (
        <div
          key={i}
          className={`flex gap-1.5 whitespace-pre-wrap break-all rounded px-1.5 ${
            r.type === 'add'
              ? 'bg-green-500/10 text-green-700 dark:text-green-300'
              : r.type === 'del'
                ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                : 'text-foreground/55'
          }`}
        >
          <span className="w-2.5 shrink-0 select-none">
            {r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' '}
          </span>
          <span>{r.text || ' '}</span>
        </div>
      ))}
      {truncated && (
        <div className="px-1.5 py-1 text-[10.5px] text-muted-foreground">
          … 差异较大，仅显示前 {DIFF_MAX_ROWS} 行（共 {rows.length.toLocaleString()} 行）
        </div>
      )}
    </div>
  )
}
