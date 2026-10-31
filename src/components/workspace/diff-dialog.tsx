'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { diffLines } from 'diff'
import { Check, FileDiff } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface DiffDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 目标文件路径 */
  filePath: string
  /** 当前文件内容 */
  original: string
  /** AI 生成的代码（应用后整体替换原内容） */
  incoming: string
  applying?: boolean
  /** 确认应用：传入按块选择重建后的最终内容（全部应用时即 incoming） */
  onConfirm: (finalContent: string) => void
  /** 批量应用进度（多代码块队列中显示「第 X / N 段」） */
  batchProgress?: { current: number; total: number }
}

type DiffRow = { type: 'add' | 'del' | 'same'; text: string }
/** 连续的 add/del 行构成一个改动块；same 行为上下文，不隶属于任何块 */
type HunkInfo = { id: number; add: number; del: number }

/** 把 diffLines 的分块展平为行序列（去掉行尾换行，空块过滤） */
function buildRows(original: string, incoming: string): DiffRow[] {
  const parts = diffLines(original, incoming)
  const rows: DiffRow[] = []
  for (const part of parts) {
    const type: DiffRow['type'] = part.added ? 'add' : part.removed ? 'del' : 'same'
    const lines = part.value.split('\n')
    // diffLines 的值总是以 \n 结尾，split 后最后一段为空串
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    for (const line of lines) rows.push({ type, text: line })
  }
  return rows
}

/** 把行序列聚合成改动块，并给出每行所属块 id（same 行为 null） */
function buildHunks(rows: DiffRow[]): { hunks: HunkInfo[]; rowHunk: (number | null)[] } {
  const hunks: HunkInfo[] = []
  const rowHunk: (number | null)[] = []
  rows.forEach((row, i) => {
    if (row.type === 'same') {
      rowHunk.push(null)
      return
    }
    const prev = i > 0 ? rowHunk[i - 1] : null
    if (prev !== null) {
      // 与上一行同块（上一行也是 add/del）
      rowHunk.push(prev)
      const h = hunks[prev]
      if (row.type === 'add') h.add++
      else h.del++
    } else {
      const id = hunks.length
      hunks.push({ id, add: row.type === 'add' ? 1 : 0, del: row.type === 'del' ? 1 : 0 })
      rowHunk.push(id)
    }
  })
  return { hunks, rowHunk }
}

/**
 * 按块选择重建应用后的内容：
 * - 选中的块：保留新增行、丢弃删除行
 * - 跳过的块：丢弃新增行、保留删除行（即维持原文件内容）
 * - 上下文行始终保留
 */
function buildFinalContent(
  rows: DiffRow[],
  rowHunk: (number | null)[],
  excluded: Set<number>,
  original: string,
  incoming: string
): string {
  // 没有改动块或全部跳过：等价于不应用，原样返回
  const totalHunks = rowHunk.reduce<number>((max, h) => Math.max(max, h ?? -1), -1) + 1
  if (totalHunks === 0 || excluded.size >= totalHunks) return original
  const kept: DiffRow[] = []
  rows.forEach((row, i) => {
    const hunkId = rowHunk[i]
    if (row.type === 'same') {
      kept.push(row)
      return
    }
    const skipped = hunkId !== null && excluded.has(hunkId)
    if (row.type === 'add' && !skipped) kept.push(row)
    else if (row.type === 'del' && skipped) kept.push(row)
  })
  if (kept.length === 0) return original
  let text = kept.map((r) => r.text).join('\n')
  // 末行换行符跟随被保留末行的来源：
  // 新增行看 AI 代码是否以换行结尾；删除行/上下文行看原文件（AI 代码块常缺末尾换行，
  // 跳过末行「幻影块」时应保留原文件的末尾换行）
  const last = kept[kept.length - 1]
  const endsNL =
    last.type === 'add'
      ? incoming.endsWith('\n')
      : original.endsWith('\n')
  if (endsNL) text += '\n'
  return text
}

/** 应用前 diff 预览：对比当前文件内容与 AI 生成的代码，支持逐块应用/跳过 */
export function DiffDialog({
  open,
  onOpenChange,
  filePath,
  original,
  incoming,
  applying,
  onConfirm,
  batchProgress,
}: DiffDialogProps) {
  const rows = useMemo(
    () => (open ? buildRows(original, incoming) : []),
    [open, original, incoming]
  )
  const { hunks, rowHunk } = useMemo(() => buildHunks(rows), [rows])
  // 被跳过的改动块 id 集合（默认全部应用；打开/切换内容时重置）
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  useEffect(() => {
    setExcluded(new Set())
  }, [open, original, incoming])

  const toggleHunk = (id: number) => {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 仅统计将应用的增删行（跳过的块不计入）
  const stats = useMemo(() => {
    let add = 0
    let del = 0
    rows.forEach((row, i) => {
      const hunkId = rowHunk[i]
      if (row.type === 'add' && hunkId !== null && !excluded.has(hunkId)) add++
      else if (row.type === 'del' && hunkId !== null && !excluded.has(hunkId)) del++
    })
    return { add, del, skipped: excluded.size, total: hunks.length }
  }, [rows, rowHunk, excluded, hunks.length])

  const finalContent = useMemo(
    () => buildFinalContent(rows, rowHunk, excluded, original, incoming),
    [rows, rowHunk, excluded, original, incoming]
  )
  const unchanged = finalContent === original

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-claude-serif">
            <FileDiff className="h-4.5 w-4.5 text-clay" />
            应用前预览改动
          </DialogTitle>
          <DialogDescription>
            {batchProgress && (
              <span className="mr-1.5 rounded-full bg-clay/10 px-1.5 py-0.5 text-[11px] text-clay">
                第 {batchProgress.current} / {batchProgress.total} 段
              </span>
            )}
            {stats.total === 0
              ? 'AI 代码与当前文件内容一致'
              : stats.skipped >= stats.total
                ? '未应用任何改动'
                : stats.skipped > 0
                  ? '部分替换'
                  : '将用 AI 代码整体替换'}{' '}
            <span className="font-mono text-foreground">{filePath}</span>
            {stats.skipped < stats.total && (
              <>
                ，将应用{' '}
                <span className="font-medium text-green-600">+{stats.add}</span>{' '}
                <span className="font-medium text-red-600">-{stats.del}</span> 行
              </>
            )}
            {stats.total > 0 && stats.skipped > 0 && (
              <span className="text-muted-foreground">
                （已跳过 {stats.skipped} / {stats.total} 块）
              </span>
            )}
            （应用后自动保存）
          </DialogDescription>
        </DialogHeader>

        {hunks.length > 0 && (
          <div className="flex shrink-0 items-center justify-between gap-2">
            <p className="text-[11.5px] text-muted-foreground">
              点击改动块标题可跳过该块（保留原文件对应内容）
            </p>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                disabled={applying || excluded.size === 0}
                onClick={() => setExcluded(new Set())}
              >
                全部应用
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                disabled={applying || excluded.size >= hunks.length}
                onClick={() => setExcluded(new Set(hunks.map((h) => h.id)))}
              >
                全部跳过
              </Button>
            </div>
          </div>
        )}

        <div className="thin-scrollbar min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card">
          {rows.length === 0 || hunks.length === 0 ? (
            <p className="p-4 text-center text-[13px] text-muted-foreground">
              内容完全一致，无需应用
            </p>
          ) : (
            <div className="font-mono text-[12px] leading-[1.55]">
              {rows.map((row, i) => {
                const hunkId = rowHunk[i]
                const hunkStartsHere =
                  hunkId !== null && (i === 0 || rowHunk[i - 1] !== hunkId)
                return (
                  <Fragment key={i}>
                    {hunkStartsHere && hunkId !== null && renderHunkHeader(hunks[hunkId])}
                    <div
                      className={`flex ${
                        row.type === 'add'
                          ? excluded.has(hunkId ?? -1)
                            ? 'bg-green-500/10 opacity-35'
                            : 'bg-green-500/10'
                          : row.type === 'del'
                            ? excluded.has(hunkId ?? -1)
                              ? 'bg-red-500/10'
                              : 'bg-red-500/10 opacity-35'
                            : ''
                      }`}
                    >
                      <span
                        className={`w-6 shrink-0 select-none text-center ${
                          row.type === 'add'
                            ? 'text-green-600'
                            : row.type === 'del'
                              ? 'text-red-500'
                              : 'text-muted-foreground/40'
                        }`}
                      >
                        {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}
                      </span>
                      <span className="whitespace-pre-wrap break-all pr-3 text-foreground/85">
                        {row.text || ' '}
                      </span>
                    </div>
                  </Fragment>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={applying}>
            取消
          </Button>
          <Button
            onClick={() => onConfirm(finalContent)}
            disabled={applying || unchanged}
            title={unchanged ? '所选块应用后与原文件一致' : undefined}
          >
            {applying ? '应用中…' : unchanged ? '无改动可应用' : '应用并保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  /** 改动块标题：勾选框 + 块序号 + 增删统计 + 应用状态，点击整行切换 */
  function renderHunkHeader(h: HunkInfo) {
    const off = excluded.has(h.id)
    return (
      <button
        type="button"
        onClick={() => toggleHunk(h.id)}
        className={`flex w-full items-center gap-2 border-y border-border/60 px-2 py-1 text-left font-sans text-[11px] transition-colors ${
          off
            ? 'bg-muted/30 text-muted-foreground hover:bg-muted/50'
            : 'bg-clay/[0.07] text-foreground/80 hover:bg-clay/[0.12]'
        }`}
        title={off ? '点击恢复应用该块' : '点击跳过该块（保留原内容）'}
      >
        <span
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
            off ? 'border-muted-foreground/40' : 'border-clay bg-clay text-white'
          }`}
        >
          {!off && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
        </span>
        <span className="font-medium">改动块 {h.id + 1}</span>
        <span className="text-green-600">+{h.add}</span>
        <span className="text-red-500">-{h.del}</span>
        <span className={`ml-auto ${off ? 'text-muted-foreground/70' : 'text-clay'}`}>
          {off ? '已跳过 · 保留原内容' : '将应用'}
        </span>
      </button>
    )
  }
}
