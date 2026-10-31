'use client'

import { useState } from 'react'
import { Loader2, FilePlus2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** 代码语言 → 建议扩展名 */
const LANGUAGE_EXT: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  html: 'html',
  css: 'css',
  markdown: 'md',
  json: 'json',
  sql: 'sql',
}

/** 根据代码语言生成建议文件名 */
export function suggestFileName(language: string): string {
  const ext = LANGUAGE_EXT[language] ?? 'txt'
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `snippet-${stamp}.${ext}`
}

interface SaveAsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 建议的默认文件名 */
  suggestedName: string
  creating?: boolean
  onConfirm: (path: string) => void
}

/** 把 AI 代码块保存为新文件 */
export function SaveAsDialog({
  open,
  onOpenChange,
  suggestedName,
  creating,
  onConfirm,
}: SaveAsDialogProps) {
  const [path, setPath] = useState(suggestedName)

  // 每次打开时重置为最新建议名（渲染期状态调整）
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setPath(suggestedName)
  }

  const trimmed = path.trim()
  const valid = trimmed.length > 0 && !trimmed.includes('..') && !/^\/+$/.test(trimmed)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-claude-serif">
            <FilePlus2 className="h-4.5 w-4.5 text-clay" />
            保存为新文件
          </DialogTitle>
          <DialogDescription>
            输入文件路径（支持多级目录，如 src/utils/helpers.js），创建后自动打开
          </DialogDescription>
        </DialogHeader>
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid && !creating) onConfirm(trimmed)
          }}
          placeholder="例如 src/utils/helpers.js"
          maxLength={200}
          autoFocus
        />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={creating}>
            取消
          </Button>
          <Button onClick={() => valid && onConfirm(trimmed)} disabled={creating || !valid}>
            {creating && <Loader2 className="h-4 w-4 animate-spin" />} 创建并打开
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
