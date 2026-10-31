'use client'

import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileText,
  FileJson,
  FilePlus2,
  FolderOpen,
  Loader2,
  MoreVertical,
  Pencil,
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

function fileIcon(language: string) {
  if (language === 'json') return FileJson
  if (language === 'markdown') return FileText
  return FileCode
}

interface FileTreeProps {
  files: FileMeta[]
  activeId: string | null
  onOpen: (id: string) => void
  onCreate: (path: string) => Promise<boolean>
  onRename: (id: string, newPath: string) => Promise<boolean>
  onDelete: (id: string) => Promise<void>
}

export function FileTree({
  files,
  activeId,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [createOpen, setCreateOpen] = useState(false)
  const [newPath, setNewPath] = useState('')
  const [creating, setCreating] = useState(false)
  const [renameTarget, setRenameTarget] = useState<FileMeta | null>(null)
  const [renamePath, setRenamePath] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FileMeta | null>(null)
  const [deleting, setDeleting] = useState(false)

  const tree = useMemo(() => buildTree(files), [files])

  const toggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
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
            </button>
            {isOpen && renderNodes(node.children, depth + 1)}
          </div>
        )
      }

      const file = node.file!
      const Icon = fileIcon(file.language)
      const isActive = file.id === activeId
      return (
        <div
          key={file.id}
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
      )
    })

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <h2 className="font-claude-serif text-[15px] font-semibold text-foreground">文件</h2>
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

      <div className="thin-scrollbar flex-1 overflow-y-auto px-2 pb-3">
        {files.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            暂无文件，点击右上角「+」新建
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
