'use client'

import { useState } from 'react'
import { Check, Copy, SquarePen, Star, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { copyTextToClipboard } from '@/lib/utils'
import type { CodeFavorite } from '@/lib/code-favorites'

interface CodeFavoritesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  favorites: CodeFavorite[]
  onRemove: (id: string) => void
  onInsert: (code: string) => void
  /** 无打开文件时禁用插入 */
  insertDisabled: boolean
}

/** 首行预览：取第一个非空行，截断到 64 字符 */
function firstLinePreview(code: string): string {
  const line = code.split('\n').find((l) => l.trim()) ?? ''
  return line.length > 64 ? `${line.slice(0, 64)}…` : line
}

/** 代码块收藏夹：列出已收藏片段，可复制 / 插入到编辑器 / 删除 */
export function CodeFavoritesDialog({
  open,
  onOpenChange,
  favorites,
  onRemove,
  onInsert,
  insertDisabled,
}: CodeFavoritesDialogProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleCopy = async (fav: CodeFavorite) => {
    const ok = await copyTextToClipboard(fav.code)
    if (ok) {
      setCopiedId(fav.id)
      setTimeout(() => setCopiedId((cur) => (cur === fav.id ? null : cur)), 1500)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-claude-serif">
            <Star className="h-4 w-4 fill-current text-clay" />
            代码块收藏夹
          </DialogTitle>
          <DialogDescription>
            点击 AI 回复代码块右上角的 ☆ 收藏，随消息流式生成完即可收藏（仅保存在本浏览器）
          </DialogDescription>
        </DialogHeader>
        {favorites.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Star className="h-7 w-7 text-clay/50" />
            <p className="font-claude-serif text-sm text-foreground/80">还没有收藏的代码块</p>
            <p className="max-w-[260px] text-xs text-muted-foreground">
              AI 回复中的代码块右上角点击 ☆ 即可收藏，方便随时复用常用片段
            </p>
          </div>
        ) : (
          <div className="thin-scrollbar max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {favorites.map((fav) => (
              <div
                key={fav.id}
                data-favorite-id={fav.id}
                className="rounded-lg border border-border bg-secondary/40 px-3 py-2 transition-colors hover:border-clay/40"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-clay/10 px-1.5 py-0.5 font-mono text-[10.5px] text-clay">
                    {fav.lang || 'code'}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/80">
                    {firstLinePreview(fav.code)}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/80">
                    {fav.code.split('\n').length} 行 ·{' '}
                    {new Date(fav.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                  </span>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 px-0 text-muted-foreground"
                      onClick={() => void handleCopy(fav)}
                      aria-label={`复制收藏 ${fav.lang || 'code'}`}
                      title="复制全部代码"
                    >
                      {copiedId === fav.id ? (
                        <Check className="h-3 w-3 text-green-600" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 px-0 text-muted-foreground"
                      disabled={insertDisabled}
                      onClick={() => {
                        onInsert(fav.code)
                        onOpenChange(false)
                      }}
                      aria-label={`插入收藏 ${fav.lang || 'code'}`}
                      title={insertDisabled ? '请先在编辑器中打开一个文件' : '插入到当前文件光标处'}
                    >
                      <SquarePen className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 px-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onRemove(fav.id)}
                      aria-label={`删除收藏 ${fav.lang || 'code'}`}
                      title="从收藏夹移除"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
