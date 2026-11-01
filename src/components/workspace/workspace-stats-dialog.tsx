'use client'

import { useEffect, useState } from 'react'
import { BarChart3, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface WorkspaceStats {
  files: number
  dirs: number
  bytes: number
  lines: number
  lastUpdated: string | null
  byExt: { ext: string; count: number; bytes: number; lines: number }[]
}

/** 字节数人性化显示（与版本历史的 formatSize 同口径） */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** 总览卡片项 */
function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-secondary/50 px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-claude-serif text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  )
}

/** 统计内容体：只在打开时挂载（Radix 关闭即卸载），每次打开都是全新状态自动重新拉取 */
function StatsBody() {
  const [stats, setStats] = useState<WorkspaceStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  // loading 为派生态：未拿到数据也未出错即在加载，避免 effect 内同步 setState
  const loading = !stats && !error

  useEffect(() => {
    let cancelled = false
    fetch('/api/workspace/stats')
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '请求失败')
        return res.json()
      })
      .then((data: WorkspaceStats) => {
        if (!cancelled) setStats(data)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '请稍后重试')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-clay" /> 正在统计…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-4 text-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  const maxBytes = stats?.byExt[0]?.bytes ?? 0

  return (
    <>
      <div className="grid grid-cols-4 gap-2">
        <StatCard label="文件" value={stats!.files} />
        <StatCard label="目录" value={stats!.dirs} />
        <StatCard label="总行数" value={stats!.lines.toLocaleString()} />
        <StatCard label="总大小" value={formatSize(stats!.bytes)} />
      </div>

      {stats!.byExt.length > 0 ? (
        <div className="mt-1">
          <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-foreground/70">
            <BarChart3 className="h-3.5 w-3.5 text-clay" /> 按类型分布
          </p>
          <div className="thin-scrollbar max-h-56 overflow-y-auto pr-1">
            {stats!.byExt.map((row) => (
              <div key={row.ext} className="py-1.5">
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="font-mono text-foreground/85">.{row.ext}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {row.count} 个 · {row.lines.toLocaleString()} 行 · {formatSize(row.bytes)}
                  </span>
                </div>
                {/* 占比条：以最大类型的字节数为基准（仅单量级参考，非精确百分比刻度） */}
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-clay/60"
                    style={{
                      width: `${maxBytes > 0 ? Math.max(4, (row.bytes / maxBytes) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="py-4 text-center text-xs text-muted-foreground">工作区暂无文件</p>
      )}

      {stats!.lastUpdated && (
        <p className="text-[11px] text-muted-foreground/80">
          最近更新：
          {new Date(stats!.lastUpdated).toLocaleString('zh-CN', { hour12: false })}
        </p>
      )}
    </>
  )
}

/** 工作区统计对话框：展示总览 + 按扩展名分布（数据来自 GET /api/workspace/stats） */
export function WorkspaceStatsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-claude-serif">工作区统计</DialogTitle>
          <DialogDescription>当前工作区的文件规模与类型分布（统计实时数据）</DialogDescription>
        </DialogHeader>
        {open && <StatsBody />}
      </DialogContent>
    </Dialog>
  )
}
