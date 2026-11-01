'use client'

import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'

/** 自定义指令存储键（发送时由 page.tsx 读取透传后端；变更时广播事件刷新头部指示点） */
export const CUSTOM_PROMPT_KEY = 'cw-custom-prompt'
export const CUSTOM_PROMPT_EVENT = 'cw-custom-prompt-changed'

/** 自定义指令上限：与后端 MAX_CUSTOM_PROMPT_CHARS 一致 */
const MAX_CHARS = 3000

export function readCustomPrompt(): string {
  if (typeof window === 'undefined') return ''
  try {
    return (window.localStorage.getItem(CUSTOM_PROMPT_KEY) ?? '').trim()
  } catch {
    return ''
  }
}

export function subscribeCustomPrompt(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CUSTOM_PROMPT_EVENT, cb)
  return () => window.removeEventListener(CUSTOM_PROMPT_EVENT, cb)
}

/** 自定义指令对话框：写入 localStorage 的个人指令，随每次对话追加到 AI 系统提示词之后（全局生效）。
 * 挂载时（对话框打开才会挂载）读取现值，保存/清除后广播事件同步头部指示点 */
export function CustomPromptDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { toast } = useToast()
  // 对话框关闭即卸载（Radix），打开时才读 localStorage，无 SSR/hydration 顾虑
  const [value, setValue] = useState(() => readCustomPrompt())
  const dirty = value.trim() !== readCustomPrompt()

  const save = () => {
    const cleaned = value.trim().slice(0, MAX_CHARS)
    try {
      if (cleaned) {
        window.localStorage.setItem(CUSTOM_PROMPT_KEY, cleaned)
      } else {
        window.localStorage.removeItem(CUSTOM_PROMPT_KEY)
      }
      window.dispatchEvent(new Event(CUSTOM_PROMPT_EVENT))
      toast({ title: cleaned ? '自定义指令已保存' : '自定义指令已清除' })
      onOpenChange(false)
    } catch {
      toast({ title: '保存失败：浏览器存储不可用', variant: 'destructive' })
    }
  }

  const clear = () => {
    setValue('')
    try {
      window.localStorage.removeItem(CUSTOM_PROMPT_KEY)
      window.dispatchEvent(new Event(CUSTOM_PROMPT_EVENT))
      toast({ title: '自定义指令已清除' })
      onOpenChange(false)
    } catch {
      toast({ title: '清除失败：浏览器存储不可用', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-claude-serif">
            <Settings2 className="h-4 w-4 text-clay" />
            自定义 AI 指令
          </DialogTitle>
          <DialogDescription>
            追加到 AI 系统提示词之后，对所有会话生效（重新生成同样遵守）。例如：回答尽量简短、
            代码注释用中文、优先使用 TypeScript、不要使用分号……
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={(e) => {
            // Ctrl/⌘ + Enter 快捷保存；Enter 换行不打断输入
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && value.trim()) {
              e.preventDefault()
              save()
            }
          }}
          maxLength={MAX_CHARS}
          rows={7}
          className="resize-none text-[13px]"
          placeholder={'写下你希望 AI 始终遵守的指令，留空表示不使用。\n示例：回答控制在 10 行以内；变量命名用驼峰；解释先给结论。'}
          aria-label="自定义 AI 指令"
        />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Ctrl/⌘ + Enter 快捷保存 · 仅保存在本浏览器</span>
          <span className="tabular-nums">{value.length}/{MAX_CHARS}</span>
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={clear}
            disabled={!readCustomPrompt()}
          >
            清除
          </Button>
          <Button size="sm" onClick={save} disabled={!value.trim() || !dirty}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
