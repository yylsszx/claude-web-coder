'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const SHORTCUT_GROUPS: { group: string; items: { keys: string[]; desc: string }[] }[] = [
  {
    group: '文件与搜索',
    items: [
      { keys: ['Ctrl/⌘', 'P'], desc: '快速打开文件（按文件名搜索）' },
      { keys: ['Ctrl/⌘', 'Shift', 'F'], desc: '全局搜索（文件名 + 内容）' },
      { keys: ['Ctrl/⌘', 'S'], desc: '保存当前文件' },
    ],
  },
  {
    group: 'AI 对话',
    items: [
      { keys: ['@'], desc: '在输入框引用文件作为 AI 上下文' },
      { keys: ['Enter'], desc: '发送消息' },
      { keys: ['Shift', 'Enter'], desc: '输入框内换行' },
      { keys: ['选中代码'], desc: '编辑器中选中后浮动工具条：解释 / 优化 / 修复' },
    ],
  },
  {
    group: '通用',
    items: [
      { keys: ['Ctrl/⌘', '/'], desc: '打开 / 关闭本快捷键帮助' },
      { keys: ['Esc'], desc: '关闭对话框、取消消息编辑' },
    ],
  },
]

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-claude-serif">键盘快捷键</DialogTitle>
          <DialogDescription>macOS 上 Ctrl 对应 ⌘ Command 键。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.group}>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {group.group}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <div
                    key={item.desc}
                    className="flex items-center justify-between gap-3 rounded-md px-1 py-1 text-[13px]"
                  >
                    <span className="text-foreground/85">{item.desc}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {item.keys.map((key) => (
                        <kbd
                          key={key}
                          className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-foreground/80 shadow-sm"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
