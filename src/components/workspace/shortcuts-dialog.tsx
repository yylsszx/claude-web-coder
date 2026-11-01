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
      { keys: ['Ctrl/⌘', 'K'], desc: '命令面板（搜索文件 / 切换会话 / 执行常用操作）' },
      { keys: ['Ctrl/⌘', 'P'], desc: '快速打开文件（按文件名搜索）' },
      { keys: ['Ctrl/⌘', 'Shift', 'F'], desc: '全局搜索（文件名 + 内容）' },
      { keys: ['Ctrl/⌘', 'F'], desc: '焦点在编辑器：查找替换；焦点在对话面板：会话内搜索消息' },
      { keys: ['Ctrl/⌘', 'S'], desc: '保存当前文件' },
      { keys: ['Ctrl/⌘', 'Alt', 'S'], desc: '保存全部未保存文件' },
      { keys: ['Ctrl/⌘', 'Z / ⇧Z'], desc: '编辑器内：撤销 / 重做（也可用工具栏按钮）' },
      { keys: ['Ctrl/⌘', 'G'], desc: '焦点在编辑器：查找下一个；焦点在编辑器外：转到指定行' },
      { keys: ['Ctrl/⌘', 'Alt', '←/→'], desc: '在打开的标签页间循环切换' },
      { keys: ['Alt', '1…9'], desc: '直达第 N 个打开的标签页' },
      { keys: ['Ctrl/⌘', 'Shift', 'T'], desc: '重新打开最近关闭的标签页' },
      { keys: ['Ctrl/⌘', 'Shift', 'K'], desc: '删除当前行 / 选区覆盖的行（可撤销）' },
      { keys: ['Ctrl/⌘', 'D'], desc: '复制当前行 / 选区（副本插到下方 / 选区之后并选中，可撤销）' },
      { keys: ['Alt', '↑/↓'], desc: '上移 / 下移当前行或选区覆盖的行块' },
      { keys: ['Ctrl/⌘', '⇧', '\\'], desc: '编辑器内：光标与配对括号间跳转（光标需紧邻括号）' },
      { keys: ['双击标签'], desc: '关闭该标签页（与中键点击等效）' },
    ],
  },
  {
    group: 'AI 对话',
    items: [
      { keys: ['@'], desc: '在输入框引用文件作为 AI 上下文' },
      { keys: ['Enter'], desc: '发送消息' },
      { keys: ['Shift', 'Enter'], desc: '输入框内换行' },
      { keys: ['Tab / Shift+Tab'], desc: '输入框内有选区时整块缩进 / 反缩进，无选区插入两个空格' },
      { keys: ['选中代码'], desc: '编辑器中选中后浮动工具条：解释 / 优化 / 修复' },
    ],
  },
  {
    group: '通用',
    items: [
      { keys: ['Ctrl/⌘', 'B'], desc: '折叠 / 展开左侧文件树' },
      { keys: ['Ctrl/⌘', 'Alt', 'B'], desc: '折叠 / 展开右侧对话面板' },
      { keys: ['Ctrl/⌘', '/'], desc: '编辑器内：切换行注释（含 Markdown 的 HTML 注释）；编辑器外：打开 / 关闭本快捷键帮助' },
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
