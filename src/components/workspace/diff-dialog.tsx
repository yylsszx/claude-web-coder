'use client'

import { useMemo } from 'react'
import { diffLines } from 'diff'
import { FileDiff } from 'lucide-react'
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
  onConfirm: () => void
}

type DiffRow = { type: 'add' | 'del' | 'same'; text: string }

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

/** 应用前 diff 预览：对比当前文件内容与 AI 生成的代码 */
export function DiffDialog({
  open,
  onOpenChange,
  filePath,
  original,
  incoming,
  applying,
  onConfirm,
}: DiffDialogProps) {
  const rows = useMemo(
    () => (open ? buildRows(original, incoming) : []),
    [open, original, incoming]
  )
  const stats = useMemo(() => {
    const add = rows.filter((r) => r.type === 'add').length
    const del = rows.filter((r) => r.type === 'del').length
    return { add, del, same: rows.length - add - del }
  }, [rows])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-claude-serif">
            <FileDiff className="h-4.5 w-4.5 text-clay" />
            应用前预览改动
          </DialogTitle>
          <DialogDescription>
            将用 AI 代码整体替换 <span className="font-mono text-foreground">{filePath}</span>
            ，共 <span className="font-medium text-green-600">+{stats.add}</span>{' '}
            <span className="font-medium text-red-600">-{stats.del}</span> 行
            （应用后自动保存）
          </DialogDescription>
        </DialogHeader>

        <div className="thin-scrollbar min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card">
          {rows.length === 0 ? (
            <p className="p-4 text-center text-[13px] text-muted-foreground">
              内容完全一致，无需应用
            </p>
          ) : (
            <div className="font-mono text-[12px] leading-[1.55]">
              {rows.map((row, i) => (
                <div
                  key={i}
                  className={`flex ${
                    row.type === 'add'
                      ? 'bg-green-500/10'
                      : row.type === 'del'
                        ? 'bg-red-500/10'
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
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={applying}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={applying || rows.length === 0}>
            {applying ? '应用中…' : '应用并保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
