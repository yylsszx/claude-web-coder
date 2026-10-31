'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileText,
  FileJson,
  FilePlus2,
  FolderOpen,
  Import,
  Loader2,
  MoreVertical,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import type { FileMeta } from '@/lib/types'

interface TreeNode {
  name: string
  isFolder: boolean
  file?: FileMeta
  children: TreeNode[]
}

/** 由扁平文件列表构建目录树 */
function buildTree(files: FileMeta[]): TreeNode[] {
  const root: TreeNode = { name: '', isFolder: true, children: [] }

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let current = root
    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1
      let child = current.children.find((c) => c.name === part && c.isFolder === !isLast)
      if (!child) {
        child = {
          name: part,
          isFolder: !isLast,
          file: isLast ? file : undefined,
          children: [],
        }
        current.children.push(child)
      }
      current = child
    })
  }

  // 排序：文件夹在前，文件夹/文件各自按名称排序
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((n) => sortNodes(n.children))
    return nodes
  }

  return sortNodes(root.children)
}

/** 统计节点内文件总数（含子孙目录） */
function countFiles(node: TreeNode): number {
  if (!node.isFolder) return 1
  return node.children.reduce((sum, child) => sum + countFiles(child), 0)
}

function fileIcon(language: string) {
  if (language === 'json') return FileJson
  if (language === 'markdown') return FileText
  return FileCode
}

/**
 * 目录展开状态作为外部存储（localStorage）：
 * SSR 快照返回共享空集合，客户端读取缓存值，避免 hydration 不一致与级联渲染
 */
const EMPTY_FOLDERS: ReadonlySet<string> = new Set()
let expandedCache: ReadonlySet<string> = EMPTY_FOLDERS
let expandedDirty = true
const expandedListeners = new Set<() => void>()

function readExpanded(): ReadonlySet<string> {
  if (!expandedDirty) return expandedCache
  try {
    const raw = localStorage.getItem('file-tree-expanded')
    expandedCache = raw ? new Set(JSON.parse(raw) as string[]) : EMPTY_FOLDERS
  } catch {
    expandedCache = EMPTY_FOLDERS
  }
  expandedDirty = false
  return expandedCache
}

function subscribeExpanded(cb: () => void) {
  expandedListeners.add(cb)
  const onStorage = () => {
    expandedDirty = true
    cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    expandedListeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

function writeExpanded(next: Set<string>) {
  expandedCache = next
  expandedDirty = false
  try {
    localStorage.setItem('file-tree-expanded', JSON.stringify([...next]))
  } catch {
    /* 存储不可用时静默降级 */
  }
  expandedListeners.forEach((l) => l())
}

interface FileTreeProps {
  files: FileMeta[]
  activeId: string | null
  /** 有未保存更改的文件 ID 列表（行尾显示橙点） */
  dirtyIds?: string[]
  onOpen: (id: string) => void
  onCreate: (path: string) => Promise<boolean>
  onRename: (id: string, newPath: string) => Promise<boolean>
  onDelete: (id: string) => Promise<void>
  onQuickOpen: () => void
  /** 拖拽本地文件到文件树导入工作区 */
  onImportFiles: (dropped: File[]) => void
  importingFiles: boolean
}

export function FileTree({
  files,
  activeId,
  dirtyIds = [],
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onQuickOpen,
  onImportFiles,
  importingFiles,
}: FileTreeProps) {
  // 目录展开状态：localStorage 外部存储，刷新后保持；SSR 渲染空快照避免 hydration 不一致
  const expanded = useSyncExternalStore(subscribeExpanded, readExpanded, () => EMPTY_FOLDERS)
  const [createOpen, setCreateOpen] = useState(false)
  const [newPath, setNewPath] = useState('')
  const [creating, setCreating] = useState(false)
  const [renameTarget, setRenameTarget] = useState<FileMeta | null>(null)
  const [renamePath, setRenamePath] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FileMeta | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 切换标签 / 打开文件时，文件树自动滚动到当前文件（不在可视区才滚，不打扰手动浏览）
  useEffect(() => {
    if (!activeId) return
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-file-id="${CSS.escape(activeId)}"]`)
      el?.scrollIntoView({ block: 'nearest' })
    }, 120) // 略等文件树渲染完成（刷新后恢复标签时列表可能尚未挂载）
    return () => clearTimeout(timer)
  }, [activeId])
  // 拖拽本地文件悬停高亮
  const [dragOver, setDragOver] = useState(false)

  const tree = useMemo(() => buildTree(files), [files])

  const toggleFolder = (path: string) => {
    const next = new Set(expanded)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    writeExpanded(next)
  }

  const handleCreate = async () => {
    if (!newPath.trim()) return
    setCreating(true)
    const ok = await onCreate(newPath.trim())
    setCreating(false)
    if (ok) {
      setCreateOpen(false)
      setNewPath('')
    }
  }

  const handleRename = async () => {
    if (!renameTarget || !renamePath.trim()) return
    setRenaming(true)
    const ok = await onRename(renameTarget.id, renamePath.trim())
    setRenaming(false)
    if (ok) setRenameTarget(null)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    await onDelete(deleteTarget.id)
    setDeleting(false)
    setDeleteTarget(null)
  }

  const renderNodes = (nodes: TreeNode[], depth: number) =>
    nodes.map((node) => {
      const nodePath = node.isFolder ? `${node.name}/` : node.file!.path
      const isOpen = expanded.has(nodePath)

      if (node.isFolder) {
        return (
          <div key={nodePath}>
            <button
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground/80 hover:bg-accent transition-colors"
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              onClick={() => toggleFolder(nodePath)}
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-clay" />
              <span className="truncate font-medium">{node.name}</span>
              <span
                className="ml-auto shrink-0 pr-0.5 text-[10px] tabular-nums text-muted-foreground/70"
                title={`${countFiles(node)} 个文件`}
              >
                {countFiles(node)}
              </span>
            </button>
            {isOpen && renderNodes(node.children, depth + 1)}
          </div>
        )
      }

      const file = node.file!
      const Icon = fileIcon(file.language)
      const isActive = file.id === activeId
      const isDirty = dirtyIds.includes(file.id)
      return (
        <ContextMenu key={file.id}>
          <ContextMenuTrigger asChild>
            <div
              data-file-id={file.id}
              className={`group flex items-center rounded-md pr-1 transition-colors ${
                isActive ? 'bg-clay/10' : 'hover:bg-accent'
              }`}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
          <button
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-[13px]"
            onClick={() => onOpen(file.id)}
          >
            <Icon
              className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-clay' : 'text-muted-foreground'}`}
            />
            <span
              className={`truncate ${isActive ? 'font-medium text-clay' : 'text-foreground/80'}`}
            >
              {node.name}
            </span>
          </button>
          {isDirty && (
            <span
              className="mr-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-clay"
              title="有未保存的更改"
              aria-label="未保存"
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
                aria-label={`${file.path} 的操作菜单`}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setRenameTarget(file)
                  setRenamePath(file.path)
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> 重命名
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteTarget(file)}
              >
                <Trash2 className="h-3.5 w-3.5" /> 删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-40">
          <ContextMenuItem
            onSelect={() => {
              setRenameTarget(file)
              setRenamePath(file.path)
            }}
          >
            <Pencil className="h-3.5 w-3.5" /> 重命名
          </ContextMenuItem>
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setDeleteTarget(file)}
          >
            <Trash2 className="h-3.5 w-3.5" /> 删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      )
    })

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        // 仅在真正离开容器（而不是移入子元素）时取消高亮
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const dropped = Array.from(e.dataTransfer.files)
        if (dropped.length) onImportFiles(dropped)
      }}
    >
      {(dragOver || importingFiles) && (
        <div
          className={`pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-clay/60 bg-background/85 backdrop-blur-[1px] ${
            dragOver ? 'rounded-none' : ''
          }`}
        >
          {importingFiles ? (
            <Loader2 className="h-5 w-5 animate-spin text-clay" />
          ) : (
            <Import className="h-5 w-5 text-clay" />
          )}
          <p className="text-[12.5px] font-medium text-clay">
            {importingFiles ? '正在导入…' : '松开导入到工作区'}
          </p>
          {!importingFiles && (
            <p className="text-[10.5px] text-muted-foreground">重名文件自动加后缀，单个不超过 1MB</p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <h2 className="font-claude-serif text-[15px] font-semibold text-foreground">文件</h2>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onQuickOpen}
            aria-label="搜索文件（Ctrl/⌘ + P）"
            title="搜索文件（Ctrl/⌘ + P）"
          >
            <Search className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setCreateOpen(true)}
            aria-label="新建文件"
          >
            <FilePlus2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </div>

      <div className="thin-scrollbar flex-1 overflow-y-auto px-2 pb-3">
        {files.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            暂无文件，点击右上角「+」新建，
            <br />
            或把本地文件拖到这里导入
          </p>
        ) : (
          renderNodes(tree, 0)
        )}
      </div>

      {/* 新建文件对话框 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-claude-serif">新建文件</DialogTitle>
            <DialogDescription>
              输入文件路径，支持目录（如 <code>src/utils/helpers.ts</code>）
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder="src/utils/helpers.ts"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={creating || !newPath.trim()}>
              {creating && <Loader2 className="h-4 w-4 animate-spin" />} 创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重命名对话框 */}
      <Dialog
        open={!!renameTarget}
        onOpenChange={(open) => !open && setRenameTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-claude-serif">重命名 / 移动文件</DialogTitle>
            <DialogDescription>可修改文件名或移动到其他目录</DialogDescription>
          </DialogHeader>
          <Input
            value={renamePath}
            onChange={(e) => setRenamePath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>
              取消
            </Button>
            <Button onClick={handleRename} disabled={renaming || !renamePath.trim()}>
              {renaming && <Loader2 className="h-4 w-4 animate-spin" />} 保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-claude-serif">确认删除文件？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除 <span className="font-medium">{deleteTarget?.path}</span>
              ，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                handleDelete()
              }}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />} 删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
