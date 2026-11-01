'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  ChevronsDownUp,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode,
  FileText,
  FileJson,
  FilePlus2,
  FolderInput,
  FolderPlus,
  FolderOpen,
  Import,
  Loader2,
  MoreVertical,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { copyTextToClipboard } from '@/lib/utils'
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

/** 正在被拖拽的目录路径：模块级变量而非 React state——拖拽事件序列（dragstart→dragover→drop）
 * 可能在同一个批处理内同步发生，state 在 drop 时还未刷新会导致守卫读到 null 落空；
 * 模块变量在 dragstart 里同步赋值，后续事件同步可读，无时序问题（dragend 必触发清空） */
let draggingDirPath: string | null = null
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
  /** 新建文件夹（写入 <path>/.gitkeep 占位文件，不自动打开标签） */
  onCreateFolder: (path: string) => Promise<boolean>
  onRename: (id: string, newPath: string) => Promise<boolean>
  onDelete: (id: string) => Promise<void>
  /** 拖拽移动文件到目录（拼 newPath 走重命名链路） */
  onMoveFile?: (fileId: string, dirPath: string) => Promise<boolean>
  /** 拖拽移动目录到另一目录（批量改前缀走 move-dir 端点；targetPath 为 '' 表示移到根） */
  onMoveDir?: (dirPath: string, targetPath: string) => Promise<boolean>
  onQuickOpen: () => void
  /** 拖拽本地文件到文件树导入工作区（.zip 会路由到压缩包导入端点） */
  onImportFiles: (dropped: File[]) => void
  /** 从本地选择 ZIP 压缩包导入（服务端解包建文件） */
  onImportZip: (file: File) => void
  importingFiles: boolean
}

export function FileTree({
  files,
  activeId,
  dirtyIds = [],
  onOpen,
  onCreate,
  onCreateFolder,
  onRename,
  onDelete,
  onMoveFile,
  onMoveDir,
  onQuickOpen,
  onImportFiles,
  onImportZip,
  importingFiles,
}: FileTreeProps) {
  const { toast } = useToast()
  // 目录展开状态：localStorage 外部存储，刷新后保持；SSR 渲染空快照避免 hydration 不一致
  const expanded = useSyncExternalStore(subscribeExpanded, readExpanded, () => EMPTY_FOLDERS)
  // 「导入 ZIP」隐藏 file input（点击工具栏图标触发）
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  // 新建对话框模式：file = 新建文件（自动打开标签）；folder = 新建文件夹（提交时补 .gitkeep）
  const [createMode, setCreateMode] = useState<'file' | 'folder'>('file')
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
  // 内部拖拽移动：悬停的目录路径（目录行高亮用）
  const [dragOverDir, setDragOverDir] = useState<string | null>(null)
  /** dataTransfer 自定义类型：标记拖拽源为本工作区文件（与外部文件导入区分） */
  const FILE_ID_TYPE = 'application/cw-file-id'
  /** dataTransfer 自定义类型：标记拖拽源为本工作区目录 */
  const DIR_ID_TYPE = 'application/cw-dir-id'
  /** 目标目录是否在被拖目录自身或其子树内（拖进自己内部没有意义） */
  const isOwnSubtree = (dragDir: string | null, target: string) =>
    !!dragDir && (target === dragDir || target.startsWith(`${dragDir}/`))

  const tree = useMemo(() => buildTree(files), [files])

  /** 树里是否有目录节点：决定「全部折叠」按钮是否可用 */
  const hasFolders = useMemo(() => {
    const walk = (nodes: TreeNode[]): boolean =>
      nodes.some((n) => n.isFolder || walk(n.children))
    return walk(tree)
  }, [tree])

  /** 全部折叠：清空展开记录（localStorage 同步清空，刷新后保持折叠态） */
  const collapseAll = () => writeExpanded(new Set<string>())

  /** 复制路径到剪贴板（文件路径 / 目录前缀通用，toast 反馈避免无感知） */
  const handleCopyPath = async (path: string) => {
    const ok = await copyTextToClipboard(path)
    toast({
      title: ok ? '路径已复制' : '复制失败',
      description: ok ? path : undefined,
      variant: ok ? undefined : 'destructive',
    })
  }

  const toggleFolder = (path: string) => {
    const next = new Set(expanded)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    writeExpanded(next)
  }

  const handleCreate = async () => {
    if (!newPath.trim()) return
    setCreating(true)
    const ok =
      createMode === 'folder'
        ? await onCreateFolder(newPath.trim())
        : await onCreate(newPath.trim())
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

  const renderNodes = (nodes: TreeNode[], depth: number, prefix = '') =>
    nodes.map((node) => {
      const nodePath = node.isFolder ? `${prefix}${node.name}/` : node.file!.path
      const isOpen = expanded.has(nodePath)

      if (node.isFolder) {
        const dirPath = `${prefix}${node.name}`
        return (
          <div key={nodePath}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DIR_ID_TYPE, dirPath)
                    e.dataTransfer.effectAllowed = 'move'
                    draggingDirPath = dirPath
                  }}
                  onDragEnd={() => {
                    draggingDirPath = null
                  }}
                  className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground/80 hover:bg-accent transition-colors ${
                    dragOverDir === nodePath ? 'bg-clay/10 ring-1 ring-inset ring-clay/70' : ''
                  }`}
                  style={{ paddingLeft: `${8 + depth * 14}px` }}
                  onClick={() => toggleFolder(nodePath)}
                  onDragOver={(e) => {
                    const acceptsFile = e.dataTransfer.types.includes(FILE_ID_TYPE)
                    const acceptsDir =
                      e.dataTransfer.types.includes(DIR_ID_TYPE) && !isOwnSubtree(draggingDirPath, dirPath)
                    if (acceptsFile || acceptsDir) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      setDragOverDir(nodePath)
                    }
                  }}
                  onDragLeave={() => {
                    setDragOverDir((cur) => (cur === nodePath ? null : cur))
                  }}
                  onDrop={(e) => {
                    const fid = e.dataTransfer.getData(FILE_ID_TYPE)
                    if (fid) {
                      e.preventDefault()
                      e.stopPropagation()
                      setDragOverDir(null)
                      void onMoveFile?.(fid, dirPath)
                      return
                    }
                    const draggedDir = e.dataTransfer.getData(DIR_ID_TYPE)
                    if (draggedDir) {
                      if (isOwnSubtree(draggingDirPath, dirPath)) return // 拖进自己 / 子孙目录：忽略
                      e.preventDefault()
                      e.stopPropagation()
                      setDragOverDir(null)
                      void onMoveDir?.(draggedDir, dirPath)
                    }
                    // 两者皆非：外部内容拖入，不拦截，冒泡给根容器走导入
                  }}
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
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuItem
                  onSelect={() => {
                    setCreateMode('file')
                    setNewPath(`${dirPath}/`)
                    setCreateOpen(true)
                  }}
                >
                  <FilePlus2 className="h-3.5 w-3.5" /> 在此目录新建文件
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => {
                    setCreateMode('folder')
                    setNewPath(`${dirPath}/`)
                    setCreateOpen(true)
                  }}
                >
                  <FolderPlus className="h-3.5 w-3.5" /> 在此目录新建文件夹
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void handleCopyPath(dirPath)}>
                  <Copy className="h-3.5 w-3.5" /> 复制目录路径
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            {isOpen && renderNodes(node.children, depth + 1, `${prefix}${node.name}/`)}
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
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(FILE_ID_TYPE, file.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
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
                onClick={() => void handleCopyPath(file.path)}
              >
                <Copy className="h-3.5 w-3.5" /> 复制路径
              </DropdownMenuItem>
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
          <ContextMenuItem onSelect={() => void handleCopyPath(file.path)}>
            <Copy className="h-3.5 w-3.5" /> 复制路径
          </ContextMenuItem>
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
        // 工作区内部拖拽移动（目录行自行处理）：不触发「导入到工作区」遮罩
        const internal =
          e.dataTransfer.types.includes(FILE_ID_TYPE) || e.dataTransfer.types.includes(DIR_ID_TYPE)
        if (!internal) setDragOver(true)
      }}
      onDragLeave={(e) => {
        // 仅在真正离开容器（而不是移入子元素）时取消高亮
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        // 内部目录拖到非目录区域 = 移到根目录
        const draggedDir = e.dataTransfer.getData(DIR_ID_TYPE)
        if (draggedDir) {
          if (!isOwnSubtree(draggingDirPath, '')) void onMoveDir?.(draggedDir, '')
          return
        }
        // 内部文件移动由目录行处理并 stopPropagation；冒泡到这里（拖到非目录区域）不动作
        if (e.dataTransfer.getData(FILE_ID_TYPE)) return
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
            disabled={!hasFolders || expanded.size === 0}
            onClick={collapseAll}
            aria-label="全部折叠"
            title="全部折叠目录"
          >
            <ChevronsDownUp className="h-4 w-4 text-muted-foreground" />
          </Button>
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
            onClick={() => {
              setCreateMode('file')
              setCreateOpen(true)
            }}
            aria-label="新建文件"
            title="新建文件"
          >
            <FilePlus2 className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              setCreateMode('folder')
              setCreateOpen(true)
            }}
            aria-label="新建文件夹"
            title="新建文件夹（写入 .gitkeep 占位文件）"
          >
            <FolderPlus className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => zipInputRef.current?.click()}
            aria-label="导入 ZIP"
            title="导入 ZIP 压缩包（服务端解包，文本文件入工作区）"
          >
            <FolderInput className="h-4 w-4 text-muted-foreground" />
          </Button>
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImportZip(f)
              // 同一文件可重复导入：清空 value 使 change 事件可再触发
              e.target.value = ''
            }}
          />
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

      {/* 新建文件 / 文件夹对话框 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-claude-serif">
              {createMode === 'folder' ? '新建文件夹' : '新建文件'}
            </DialogTitle>
            <DialogDescription>
              {createMode === 'folder' ? (
                <>
                  输入文件夹路径（如 <code>src/components</code>），写入 .gitkeep 占位文件
                </>
              ) : (
                <>
                  输入文件路径，支持目录（如 <code>src/utils/helpers.ts</code>）
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder={createMode === 'folder' ? 'src/components' : 'src/utils/helpers.ts'}
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
