'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  AtSign,
  Check,
  Copy,
  CopyPlus,
  Download,
  Eraser,
  FileCode2,
  ImagePlus,
  Loader2,
  MessageSquarePlus,
  Archive,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Quote,
  Search,
  SendHorizonal,
  Sparkles,
  Square,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
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
import { AiMessage } from '@/components/workspace/ai-message'
import { copyTextToClipboard } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import type { ChatMsg, FileMeta, SessionMeta } from '@/lib/types'
import { useMounted } from '@/hooks/use-mounted'

interface ChatPanelProps {
  messages: ChatMsg[]
  loading: boolean
  streamingId: string | null
  activeFilePath: string | null
  /** 工作区全部文件（供 @ 引用搜索） */
  files: FileMeta[]
  sessions: SessionMeta[]
  activeSessionId: string | null
  onSwitchSession: (id: string) => void
  onCreateSession: () => void
  onRenameSession: (id: string, title: string) => Promise<boolean>
  onDeleteSession: (id: string) => void
  /** 切换会话置顶 */
  onTogglePin: (id: string, pinned: boolean) => void
  /** 导入会话备份（.json 单会话 / .zip 批量恢复，与导出闭环） */
  onImportSessionJson: (file: File) => void
  /** 导出全部会话为 ZIP 备份（每会话一个 JSON + manifest） */
  onExportAllSessions: () => void
  /** 导出会话为 JSON 备份（拉取该会话全部消息，结构化下载） */
  onExportSessionJson: (id: string) => void
  /** 克隆会话（复制标题与全部消息为新会话并切到副本） */
  onDuplicateSession: (id: string) => void
  /** 发送消息；includeFile 控制是否把当前打开的文件作为上下文发给 AI；mentionIds 为 @ 引用的文件；attachments 为图片附件 */
  onSend: (message: string, includeFile: boolean, mentionIds?: string[], attachments?: string[]) => void
  onStop: () => void
  onClear: () => void
  onApplyCode: (code: string) => void
  /** 重新生成最后一条 AI 回复 */
  onRegenerate: () => void
  /** 把代码块保存为新文件 */
  onSaveAsCode: (code: string, language: string) => void
  /** 打开指定文件（AI 回复中文件路径点击时调用） */
  onOpenFile: (id: string) => void
  /** 插入到编辑器当前光标位置（无打开文件时禁用） */
  onInsertCode?: (code: string) => void
  /** 批量应用：依次为每段代码选目标并 diff 确认 */
  onApplyAll?: (codes: string[]) => void
  /** 导出当前会话为 Markdown */
  onExportChat: () => void
  /** 编辑历史用户消息并重发（服务端丢弃其后所有消息） */
  onEditResend: (messageId: string, newContent: string) => void
  /** 删除单条消息（两步确认后调用；生成中 / 临时消息由内部守卫禁删） */
  onDeleteMessage: (messageId: string) => void
  /** 勾选 AI 回复任务列表项：乐观更新 + 持久化（失败由上层回滚并提示） */
  onToggleTaskContent?: (msgId: string, content: string, prevContent: string) => void
}

const QUICK_ACTIONS = [
  { label: '解释当前文件', prompt: '请逐段解释当前文件的作用，并指出可改进之处。' },
  { label: '优化当前文件', prompt: '请优化当前文件的代码质量、可读性与性能，给出完整的优化后代码。' },
  { label: '修复 Bug', prompt: '请检查当前文件中的潜在 Bug 并给出修复后的完整代码。' },
]

/** 空会话引导：点击直接填入输入框 */
const STARTER_PROMPTS = [
  {
    label: '创建一个网页小游戏',
    prompt: '帮我创建一个贪吃蛇小游戏，单个 HTML 文件，包含键盘控制与计分板。',
  },
  {
    label: '写一个处理脚本',
    prompt: '用 Python 写一个脚本：把指定目录下的图片按修改时间重命名为 001.png、002.png……',
  },
  {
    label: '解释一段代码',
    prompt: '请逐段解释当前打开文件的作用，并指出可改进之处。',
  },
]

/** 输入历史的 localStorage 键前缀（按会话隔离，与草稿同套机制） */
const HIST_KEY_PREFIX = 'cw-chat-hist-'

/** 图片附件限制：每条消息最多 4 张，超过 1MB 或长边超 1600px 时压到 JPEG */
const MAX_PENDING_IMAGES = 4

/** 把图片文件读为 data URL（超过阈值时 canvas 重编码为 JPEG，先填白底保留透明区可读） */
async function fileToCompressedDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取失败'))
    reader.readAsDataURL(file)
  })
  // SVG 交给浏览器矢量渲染，不栅格化
  if (file.type === 'image/svg+xml') return dataUrl
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = dataUrl
  })
  const maxEdge = Math.max(img.naturalWidth, img.naturalHeight)
  if (maxEdge <= 1600 && dataUrl.length <= 1_400_000) return dataUrl
  const scale = Math.min(1, 1600 / maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

/** 读取某会话的输入历史（损坏 / 非数组数据当作空历史，截留最近 50 条） */
const readInputHistory = (sid: string | null): string[] => {
  if (!sid) return []
  try {
    const raw = localStorage.getItem(HIST_KEY_PREFIX + sid)
    const arr: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === 'string').slice(-50)
      : []
  } catch {
    return []
  }
}

/** 写入某会话的输入历史（仅保留最近 50 条，存储不可用时静默） */
const writeInputHistory = (sid: string | null, hist: string[]) => {
  if (!sid) return
  try {
    localStorage.setItem(HIST_KEY_PREFIX + sid, JSON.stringify(hist.slice(-50)))
  } catch {
    /* 存储不可用时静默 */
  }
}

export function ChatPanel({
  messages,
  loading,
  streamingId,
  activeFilePath,
  files,
  sessions,
  activeSessionId,
  onSwitchSession,
  onCreateSession,
  onRenameSession,
  onDeleteSession,
  onTogglePin,
  onImportSessionJson,
  onExportAllSessions,
  onExportSessionJson,
  onDuplicateSession,
  onSend,
  onStop,
  onClear,
  onApplyCode,
  onRegenerate,
  onSaveAsCode,
  onOpenFile,
  onInsertCode,
  onApplyAll,
  onExportChat,
  onToggleTaskContent,
  onEditResend,
  onDeleteMessage,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const { toast } = useToast()
  // 待发送图片附件（data URL 数组；随下一条消息发出后清空）
  const [pendingAttachments, setPendingAttachments] = useState<string[]>([])
  // 已发送消息的附件大图预览（点击缩略图打开）
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  // 智能滚动：用户接近底部时才跟随流式输出，向上翻阅时不再被拽回
  const stickToBottomRef = useRef(true)
  const [showJumpButton, setShowJumpButton] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // 输入历史回溯：发送过的消息按序记录，空输入时 ↑ 取上一条 / ↓ 向新方向前进；按会话持久化
  const inputHistoryRef = useRef<string[]>([])
  const histIndexRef = useRef<number | null>(null)
  // 回溯前的原草稿（↓ 走到末尾时恢复；仅空输入可触发回溯，故初始为空串）
  const histDraftRef = useRef('')
  const panelRef = useRef<HTMLDivElement | null>(null)
  // 时间戳等依赖客户端时钟/时区的内容仅在挂载后渲染，避免 SSR hydration mismatch
  const mounted = useMounted()
  // 当前文件是否作为上下文附加给 AI（切换文件时自动重新附加）
  const [fileAttached, setFileAttached] = useState(true)
  const [lastFilePath, setLastFilePath] = useState<string | null>(activeFilePath)
  if (lastFilePath !== activeFilePath) {
    setLastFilePath(activeFilePath)
    setFileAttached(true)
  }
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false)
  // 打开会话下拉时自动把当前会话滚进可视区（会话多时当前项可能藏在滚动区外）
  useEffect(() => {
    if (!sessionMenuOpen || !activeSessionId) return
    const t = window.setTimeout(() => {
      document
        .querySelector(`[data-session-row="${CSS.escape(activeSessionId)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }, 60) // 略等下拉内容渲染完成
    return () => window.clearTimeout(t)
  }, [sessionMenuOpen, activeSessionId])
  // 会话列表搜索过滤
  const [sessionFilter, setSessionFilter] = useState('')
  // 会话下拉行内重命名：点「重命名」铅笔后标题变输入框（Enter 保存 / Esc 或失焦取消），不再弹窗
  const [inlineRenameId, setInlineRenameId] = useState<string | null>(null)
  // 拖拽 .json 备份到聊天头部导入：dragover 高亮提示（离开 / 松开复位）
  const [dragOverHeader, setDragOverHeader] = useState(false)
  const dragDepthRef = useRef(0)
  const [inlineRenameValue, setInlineRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SessionMeta | null>(null)
  // 消息级操作：复制反馈 / 内联编辑
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  // 单条消息删除两步确认：点一次变「确认删除」，2.5 秒内再点才执行，超时自动还原
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 进入待确认态（换一条时自动重置计时）；再次点击同一条才真正删除 */
  const askDeleteMessage = (id: string) => {
    setConfirmDeleteId(id)
    if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current)
    confirmDeleteTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 2500)
  }
  /** 确认删除并清理计时器 */
  const confirmDeleteMessage = (id: string) => {
    if (confirmDeleteTimerRef.current) {
      clearTimeout(confirmDeleteTimerRef.current)
      confirmDeleteTimerRef.current = null
    }
    setConfirmDeleteId(null)
    onDeleteMessage(id)
  }
  useEffect(
    () => () => {
      if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current)
    },
    []
  )

  // ===== 流式生成实时计时 =====
  const [elapsedSec, setElapsedSec] = useState<number | null>(null)

  // ===== 输入框拖拽调高：默认 200px，向上拖增大，双击复位，偏好持久化 =====
  const INPUT_MAX_H_KEY = 'cw-input-max-h'
  const [inputMaxH, setInputMaxH] = useState(200)
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(INPUT_MAX_H_KEY))
      if (Number.isFinite(v) && v >= 96 && v <= 480) setInputMaxH(v)
    } catch {
      /* 存储不可用时用默认值 */
    }
  }, [])

  /** 拖拽调整输入框最大高度（pointer 事件统一鼠标 / 触摸）；松手持久化，双击复位 200 */
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = inputMaxH
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    let latest = startH
    const onMove = (ev: PointerEvent) => {
      latest = Math.min(480, Math.max(96, Math.round(startH + (startY - ev.clientY))))
      setInputMaxH(latest)
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      try {
        localStorage.setItem(INPUT_MAX_H_KEY, String(latest))
      } catch {
        /* 存储不可用时静默 */
      }
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  // ===== @ 文件引用 =====
  const [mentions, setMentions] = useState<FileMeta[]>([])
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)

  const mentionMatches = useMemo(() => {
    const q = mentionQuery.toLowerCase()
    return files.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 6)
  }, [files, mentionQuery])

  // 渲染期调整：匹配列表变化时把高亮索引拉回有效范围
  if (mentionOpen && mentionIndex >= mentionMatches.length) {
    setMentionIndex(0)
  }

  // ===== 会话内消息搜索 =====
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searching = searchQuery.trim().length > 0
  const visibleMessages = useMemo(() => {
    if (!searching) return messages
    const q = searchQuery.trim().toLowerCase()
    return messages.filter((m) => m.content.toLowerCase().includes(q))
  }, [messages, searching, searchQuery])

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  // 草稿按会话持久化：输入时实时写入 localStorage（handleInputChange / pickMention），
  // 切会话时恢复对应草稿、发送后清除；刷新后不丢
  const [lastDraftSession, setLastDraftSession] = useState<string | null>(activeSessionId)
  if (lastDraftSession !== activeSessionId) {
    setLastDraftSession(activeSessionId)
    let restored = ''
    try {
      restored = activeSessionId
        ? localStorage.getItem(`cw-chat-draft-${activeSessionId}`) ?? ''
        : ''
    } catch {
      /* 存储不可用时用空草稿 */
    }
    setInput(restored)
    // 同步恢复该会话的输入历史，退出回溯浏览态
    inputHistoryRef.current = readInputHistory(activeSessionId)
    histIndexRef.current = null
    // 切换会话后输入框自动聚焦，直接开始输入
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  // 首次挂载恢复当前会话草稿：ChatPanel 在数据就绪后才挂载（initialLoading 期间不渲染），
  // 此时 lastDraftSession 初始值即 activeSessionId，上面的渲染期分支不会触发，需在此补一次恢复
  useEffect(() => {
    let draft = ''
    try {
      draft = activeSessionId
        ? localStorage.getItem(`cw-chat-draft-${activeSessionId}`) ?? ''
        : ''
    } catch {
      /* 存储不可用时忽略 */
    }
    if (draft) setInput(draft)
    // 挂载时恢复当前会话的输入历史
    inputHistoryRef.current = readInputHistory(activeSessionId)
    // 仅挂载时执行一次（activeSessionId 取挂载时刻的最终值）
  }, [])

  // 焦点在对话面板内时 Ctrl/⌘ + F 打开会话内搜索（不干扰编辑器/全局搜索）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return
      if (e.key.toLowerCase() !== 'f') return
      const panel = panelRef.current
      const active = document.activeElement
      if (!panel || !active || !panel.contains(active)) return
      e.preventDefault()
      setSearchOpen(true)
      setSearchQuery('')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /** 会话下拉按标题过滤（打开时清空）；置顶会话始终排在最前（组内保持最近更新序） */
  const filteredSessions = useMemo(() => {
    const q = sessionFilter.trim().toLowerCase()
    const list = q
      ? sessions.filter((s) => s.title.toLowerCase().includes(q))
      : sessions
    return [...list].sort(
      (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false)
    )
  }, [sessions, sessionFilter])

  useEffect(() => {
    if (!stickToBottomRef.current) return
    const el = listRef.current
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages.length, loading, messages[messages.length - 1]?.content])

  /** 消息列表滚动：距底 80px 内视为跟随；离开底部时出现「回到底部」按钮 */
  const handleListScroll = () => {
    const el = listRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stickToBottomRef.current = near
    setShowJumpButton(!near)
  }

  /** 回到底部并恢复跟随 */
  const jumpToBottom = () => {
    stickToBottomRef.current = true
    setShowJumpButton(false)
    const el = listRef.current
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  /** 输入框随内容自动增高（上限可拖拽调节，超出内部滚动），发送清空后自动回落 */
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, inputMaxH)}px`
  }, [input, inputMaxH])

  /** 流式计时：loading 期间每秒跳动，结束 / 中断后归零；定格耗时由 durationMs 展示 */
  useEffect(() => {
    if (!loading) {
      setElapsedSec(null)
      return
    }
    const t0 = Date.now()
    setElapsedSec(0)
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - t0) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [loading])

  /** 消息时间：今天显示「今天 HH:MM」，今年显示「M月D日 HH:MM」，更早带年份 */
  const formatMsgTime = (iso: string) => {
    const t = new Date(iso)
    if (Number.isNaN(t.getTime())) return ''
    const now = new Date()
    const hm = t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    if (
      t.getFullYear() === now.getFullYear() &&
      t.getMonth() === now.getMonth() &&
      t.getDate() === now.getDate()
    ) {
      return `今天 ${hm}`
    }
    const y = t.getFullYear() === now.getFullYear() ? '' : `${t.getFullYear()}年`
    return `${y}${t.getMonth() + 1}月${t.getDate()}日 ${hm}`
  }

  /** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 超过一个月显示日期 */
  const formatRelativeTime = (iso: string) => {
    const t = new Date(iso)
    if (Number.isNaN(t.getTime())) return ''
    const min = Math.floor((Date.now() - t.getTime()) / 60000)
    if (min < 1) return '刚刚'
    if (min < 60) return `${min} 分钟前`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h} 小时前`
    const d = Math.floor(h / 24)
    if (d < 30) return `${d} 天前`
    const now = new Date()
    const y = t.getFullYear() === now.getFullYear() ? '' : `${t.getFullYear()}年`
    return `${y}${t.getMonth() + 1}月${t.getDate()}日`
  }

  /** 发送；forceIncludeFile 用于快捷指令（始终携带当前文件）；@ 引用随消息一并发出；图片附件随消息发出后清空 */
  const send = (text: string, forceIncludeFile?: boolean) => {
    const trimmed = text.trim()
    if ((!trimmed && pendingAttachments.length === 0) || loading) return
    const attachments = pendingAttachments.length ? pendingAttachments : undefined
    onSend(
      trimmed || '请看这张图',
      forceIncludeFile ?? (fileAttached && !!activeFilePath),
      mentions.length ? mentions.map((m) => m.id) : undefined,
      attachments
    )
    // 记录到输入历史（去重连续重复；上限 50 条）并按会话持久化，回溯游标复位
    const hist = inputHistoryRef.current
    if (trimmed && hist[hist.length - 1] !== trimmed) hist.push(trimmed)
    if (hist.length > 50) hist.shift()
    histIndexRef.current = null
    histDraftRef.current = ''
    writeInputHistory(activeSessionId, hist)
    setInput('')
    setPendingAttachments([])
    try {
      if (activeSessionId) localStorage.removeItem(`cw-chat-draft-${activeSessionId}`)
    } catch {
      /* 存储不可用时静默 */
    }
    setMentions([])
    setMentionOpen(false)
    setMentionQuery('')
    // 用户主动发送：恢复跟随并滚到底部
    stickToBottomRef.current = true
    setShowJumpButton(false)
  }

  /** 把图片文件加入待发送区：仅 image/*，超上限截断并提示，逐个压缩后入列 */
  const addImageFiles = async (fileList: FileList | File[]) => {
    const images = Array.from(fileList).filter((f) => f.type.startsWith('image/'))
    if (!images.length) return
    if (images.length > MAX_PENDING_IMAGES) {
      toast({
        title: `单条消息最多 ${MAX_PENDING_IMAGES} 张图片`,
        description: '已只保留前 4 张，其余忽略',
      })
    }
    const candidates = images.slice(0, MAX_PENDING_IMAGES)
    setPendingAttachments((prev) => {
      const room = MAX_PENDING_IMAGES - prev.length
      if (room <= 0) return prev
      return [...prev, ...candidates.slice(0, room).map(() => '')] // 先占位（压缩完成前不渲染空项）
    })
    const compressed = await Promise.all(
      candidates.map((f) =>
        fileToCompressedDataUrl(f).catch(() => null)
      )
    )
    setPendingAttachments((prev) => {
      const next = [...prev]
      let added = 0
      let failed = 0
      for (let i = 0; i < compressed.length; i++) {
        const url = compressed[i]
        const idx = next.indexOf('')
        if (!url) {
          failed++
          if (idx !== -1) next.splice(idx, 1)
          continue
        }
        if (idx !== -1) next[idx] = url
        else if (next.length < MAX_PENDING_IMAGES) next.push(url)
        added++
      }
      if (failed > 0) {
        toast({
          title: `${failed} 张图片读取失败`,
          description: '仅支持常见图片格式，已跳过',
          variant: 'destructive',
        })
      }
      return added > 0 || failed > 0 ? next : prev
    })
  }

  const isStreaming = (id: string) => id === streamingId
  const lastMsgIndex = messages.length - 1
  const canRegenerate =
    !loading &&
    lastMsgIndex >= 1 &&
    messages[lastMsgIndex]?.role === 'assistant' &&
    messages.some((m) => m.role === 'user')

  /** 检测光标前的 @token：形如「空白或开头 + @ + 非空格文本」 */
  const detectMention = (value: string, caret: number) => {
    const before = value.slice(0, caret)
    const match = before.match(/(^|\s)@([^\s@]*)$/)
    if (match) {
      setMentionQuery(match[2])
      setMentionOpen(true)
    } else {
      setMentionOpen(false)
      setMentionQuery('')
    }
  }

  /** 输入时实时持久化当前会话草稿（切会话 / 刷新后可恢复） */
  const persistDraft = (text: string) => {
    if (!activeSessionId) return
    try {
      if (text) localStorage.setItem(`cw-chat-draft-${activeSessionId}`, text)
      else localStorage.removeItem(`cw-chat-draft-${activeSessionId}`)
    } catch {
      /* 存储不可用时静默 */
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)
    persistDraft(value)
    detectMention(value, e.target.selectionStart ?? value.length)
  }

  /** 判定粘贴文本是否像代码：≥2 行、未带围栏、且命中至少两个代码特征（避免把普通段落误包） */
  const looksLikeCode = (text: string): boolean => {
    if (text.split('\n').length < 2) return false
    if (text.trimStart().startsWith('```')) return false // 已带围栏不重复包裹
    let signals = 0
    if (/[{};]\s*$/m.test(text)) signals++ // 行尾花括号 / 分号
    if (/^\s*(def |class |function |const |let |var |import |from |#include|package |using |public |private )/m.test(text)) signals++
    if (/(=>|::|&&|\|\||!==|===)/.test(text)) signals++
    if (/^\s{2,}\S/m.test(text)) signals++ // 缩进结构
    if (/<\/?[a-zA-Z][^>]*>/.test(text)) signals++ // HTML / XML 标签
    if (/^\s*[\w.-]+\(.*\)\s*:?\s*$/m.test(text)) signals++ // 函数调用行
    return signals >= 2
  }

  /** 粘贴：优先拦截剪贴板中的图片（截图直接发 AI），否则文本粘贴照旧 */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files ?? [])
    const hasImage = files.some((f) => f.type.startsWith('image/'))
    if (hasImage) {
      e.preventDefault()
      void addImageFiles(files)
      return
    }
    const text = e.clipboardData.getData('text/plain')
    if (!text || !looksLikeCode(text)) return
    e.preventDefault()
    const ta = e.currentTarget
    const fenced = '```\n' + text.replace(/\n+$/, '') + '\n```'
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const next = input.slice(0, start) + fenced + input.slice(end)
    setInput(next)
    persistDraft(next)
    requestAnimationFrame(() => {
      ta.setSelectionRange(start + fenced.length, start + fenced.length)
    })
  }

  /** 选中候选文件：替换输入框中的 @token，插入 @path 并记录引用 */
  const pickMention = (file: FileMeta) => {
    const el = textareaRef.current
    const caret = el?.selectionStart ?? input.length
    const before = input.slice(0, caret)
    const after = input.slice(caret)
    const atIdx = before.lastIndexOf('@')
    const newText =
      atIdx >= 0 ? before.slice(0, atIdx) + '@' + file.path + ' ' + after : input
    setInput(newText)
    persistDraft(newText)
    setMentionOpen(false)
    setMentionQuery('')
    setMentions((prev) => (prev.some((m) => m.id === file.id) ? prev : [...prev, file]))
    requestAnimationFrame(() => {
      el?.focus()
      const pos = atIdx >= 0 ? atIdx + file.path.length + 2 : newText.length
      el?.setSelectionRange(pos, pos)
    })
  }

  /** 历史条目填入输入框：把光标移到末尾（不写草稿存储，避免覆盖用户已输入的草稿） */
  const applyHistEntry = (text: string) => {
    setInput(text)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) el.setSelectionRange(el.value.length, el.value.length)
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // @ 下拉打开时优先处理候选导航
    if (mentionOpen && mentionMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % mentionMatches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length)
        return
      }
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        e.preventDefault()
        pickMention(mentionMatches[Math.min(mentionIndex, mentionMatches.length - 1)])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionOpen(false)
        return
      }
    }
    // 输入历史回溯：空输入时 ↑ 进入浏览，浏览中可连续 ↑/↓ 翻阅（终端式）；非浏览态不干扰多行光标移动
    if (
      e.key === 'ArrowUp' &&
      (!input || histIndexRef.current !== null) &&
      !e.nativeEvent.isComposing &&
      inputHistoryRef.current.length > 0
    ) {
      e.preventDefault()
      const hist = inputHistoryRef.current
      const idx =
        histIndexRef.current === null
          ? hist.length - 1
          : Math.max(0, histIndexRef.current - 1)
      histIndexRef.current = idx
      applyHistEntry(hist[idx])
      return
    }
    if (e.key === 'ArrowDown' && histIndexRef.current !== null && !e.nativeEvent.isComposing) {
      e.preventDefault()
      const hist = inputHistoryRef.current
      const idx = histIndexRef.current + 1
      if (idx >= hist.length) {
        // 走到末尾：恢复回溯前的原草稿
        histIndexRef.current = null
        applyHistEntry(histDraftRef.current)
      } else {
        histIndexRef.current = idx
        applyHistEntry(hist[idx])
      }
      return
    }
    if (e.key === 'Tab' && !e.nativeEvent.isComposing && !mentionOpen) {
      e.preventDefault()
      const el = textareaRef.current
      if (!el) return
      const value = el.value
      const start = el.selectionStart ?? 0
      const end = el.selectionEnd ?? 0
      let next: string
      let selStart: number
      let selEnd: number
      if (start === end && !e.shiftKey) {
        // 无选区 Tab：光标处插入两个空格
        next = value.slice(0, start) + '  ' + value.slice(end)
        selStart = selEnd = start + 2
      } else {
        // 有选区（或 Shift+Tab）：选区覆盖的行整体缩进 / 反缩进
        const lineStart = value.lastIndexOf('\n', start - 1) + 1
        let lineEnd = value.indexOf('\n', end)
        if (lineEnd === -1) lineEnd = value.length
        const block = value.slice(lineStart, lineEnd)
        const lines = block.split('\n')
        const firstLine = lines[0] ?? ''
        if (e.shiftKey) {
          // 反缩进：每行行首删除至多 2 个空格或 1 个制表符
          const stripped = lines.map((l) => l.replace(/^(\t| {1,2})/, ''))
          next = value.slice(0, lineStart) + stripped.join('\n') + value.slice(lineEnd)
          const removedFirst = firstLine.length - (stripped[0] ?? '').length
          // 反缩进后选区塌缩到原起点平移后的位置（多数编辑器同款行为）
          selStart = selEnd = Math.max(lineStart, start - removedFirst)
        } else {
          // 缩进：非空行行首加两个空格
          const indented = lines.map((l) => (l.trim() ? '  ' + l : l))
          next = value.slice(0, lineStart) + indented.join('\n') + value.slice(lineEnd)
          const delta = next.length - value.length
          selStart = start + (firstLine.trim() ? 2 : 0)
          selEnd = end + delta
        }
      }
      setInput(next)
      persistDraft(next)
      requestAnimationFrame(() => {
        const t = textareaRef.current
        if (!t) return
        t.setSelectionRange(selStart, selEnd)
      })
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send(input)
    }
  }

  /** 复制消息原文，短暂显示已复制 */
  const copyMessage = async (msg: ChatMsg) => {
    const ok = await copyTextToClipboard(msg.content)
    if (ok) {
      setCopiedId(msg.id)
      setTimeout(() => setCopiedId((cur) => (cur === msg.id ? null : cur)), 1500)
    }
  }

  /** 引用回复：把该条 AI 回复的摘要以 Markdown 引用格式填入输入框，便于针对性追问 */
  const quoteMessage = (content: string) => {
    const lines = content
      .split('\n')
      .map((l) => l.replace(/^[\s#>*`\-|]+/, '').trim()) // 剥掉标题 / 列表 / 引用等 Markdown 前缀
      .filter(Boolean)
      .slice(0, 3)
      .map((l) => (l.length > 80 ? l.slice(0, 80) + '…' : l))
    if (lines.length === 0) return
    const quoted = lines.map((l) => '> ' + l).join('\n') + '\n\n'
    histIndexRef.current = null // 退出输入历史浏览态，转入正常草稿编辑
    setInput((prev) => (prev.startsWith(quoted) ? prev : quoted + prev))
    // 受控值渲染后聚焦并把光标移到末尾，直接继续输入
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      const end = el.value.length
      el.setSelectionRange(end, end)
    })
  }

  /** 开始编辑用户消息 */
  const startEdit = (msg: ChatMsg) => {
    setEditingId(msg.id)
    setEditingText(msg.content)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditingText('')
  }

  /** 提交编辑并重发 */
  const submitEdit = () => {
    if (!editingId || !editingText.trim()) return
    const id = editingId
    cancelEdit()
    onEditResend(id, editingText)
  }

  /** 用户消息可编辑：非流式中、非临时 ID（临时 ID 只在生成中断后出现） */
  const canEdit = (msg: ChatMsg) => !loading && !msg.id.startsWith('tmp-')

  /** 单条消息删除按钮：两步确认（点一次变红色「确认删除」，2.5 秒内不再点自动还原；同 canEdit 守卫：生成中 / 临时消息不可删） */
  const renderDeleteBtn = (msg: ChatMsg) =>
    confirmDeleteId === msg.id ? (
      <button
        className="flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[11px] text-destructive transition-colors hover:bg-destructive/20"
        onClick={() => confirmDeleteMessage(msg.id)}
        title="再次点击确认删除（不可恢复）"
      >
        <Trash2 className="h-3 w-3" />
        确认删除
      </button>
    ) : (
      <button
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
        onClick={() => askDeleteMessage(msg.id)}
        title="删除此条消息"
      >
        <Trash2 className="h-3 w-3" />
        删除
      </button>
    )

  /** 用户消息中的 @ 文件路径渲染为高亮 chip（@ 前不能是字母/数字/@，避免误判邮箱等） */
  const renderMentions = (text: string): React.ReactNode => {
    const re = /(^|[^A-Za-z0-9_@])(@[\w./\-]+)/g
    const parts: React.ReactNode[] = []
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      // 前缀（行首或分隔符）保持普通文本
      const start = m.index + m[1].length
      if (start > last) parts.push(text.slice(last, start))
      parts.push(
        <span
          key={parts.length}
          className="rounded bg-clay/10 px-1 py-0.5 font-mono text-[12px] text-clay"
        >
          {m[2]}
        </span>
      )
      last = start + m[2].length
    }
    if (last < text.length) parts.push(text.slice(last))
    return parts
  }

  /** 搜索态下把关键词高亮（仅用户消息纯文本部分） */
  const highlightText = (text: string, query: string): React.ReactNode => {
    if (!query) return text
    const lower = text.toLowerCase()
    const q = query.toLowerCase()
    if (!lower.includes(q)) return text
    const parts: React.ReactNode[] = []
    let i = 0
    let idx = lower.indexOf(q)
    while (idx !== -1) {
      if (idx > i) parts.push(text.slice(i, idx))
      parts.push(
        <mark key={parts.length} className="rounded-sm bg-clay/25 px-0.5 text-foreground">
          {text.slice(idx, idx + q.length)}
        </mark>
      )
      i = idx + q.length
      idx = lower.indexOf(q, i)
    }
    if (i < text.length) parts.push(text.slice(i))
    return parts
  }

  /** 会话摘要：取最后一条消息首个非空非代码围栏行，剥掉 Markdown 前缀后截断 */
  const sessionPreview = (raw?: string): string | undefined => {
    if (!raw) return undefined
    const line =
      raw.split('\n').find((l) => l.trim() && !/^```/.test(l.trim())) ?? ''
    const cleaned = line.replace(/^[\s#>*`\-|\d.]+/, '').trim()
    if (!cleaned) return undefined
    return cleaned.length > 60 ? cleaned.slice(0, 60) + '…' : cleaned
  }

  return (
    <div ref={panelRef} className="flex h-full flex-col">
      {/* 头部：会话切换器 */}
      <div
        className={`flex items-center gap-1.5 border-b bg-card px-3 py-2 transition-colors ${
          dragOverHeader
            ? 'border-dashed border-clay bg-clay/5'
            : 'border-border'
        }`}
        onDragEnter={(e) => {
          if (![...e.dataTransfer.types].includes('Files')) return
          e.preventDefault()
          dragDepthRef.current += 1
          setDragOverHeader(true)
        }}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes('Files')) return
          e.preventDefault() // 允许 drop
        }}
        onDragLeave={() => {
          dragDepthRef.current -= 1
          if (dragDepthRef.current <= 0) {
            dragDepthRef.current = 0
            setDragOverHeader(false)
          }
        }}
        onDrop={(e) => {
          dragDepthRef.current = 0
          setDragOverHeader(false)
          const file = e.dataTransfer.files?.[0]
          if (!file) return
          const lower = file.name.toLowerCase()
          if (!lower.endsWith('.json') && !lower.endsWith('.zip')) {
            e.preventDefault()
            return // 非 json / zip 文件交给默认行为（如拖到输入框附件），不做导入
          }
          e.preventDefault()
          onImportSessionJson(file)
        }}
      >
        <Sparkles className="h-4 w-4 shrink-0 text-clay" />
        <Popover open={sessionMenuOpen} onOpenChange={(open) => {
          setSessionMenuOpen(open)
          if (open) setSessionFilter('')
        }}>
          <PopoverTrigger asChild>
            <button
              className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent"
              title="切换会话（双击重命名）"
              onDoubleClick={() => {
                if (!activeSession || loading) return
                // 打开下拉并直接进入该会话的行内重命名
                setSessionFilter('')
                setSessionMenuOpen(true)
                setInlineRenameId(activeSession.id)
                setInlineRenameValue(activeSession.title)
              }}
            >
              <span className="font-claude-serif truncate text-[14px] font-semibold">
                {activeSession?.title ?? '选择会话'}
              </span>
              {activeSession?.pinned && (
                <Pin className="h-3 w-3 shrink-0 fill-current text-clay" />
              )}
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {activeSession && mounted
                  ? `${formatRelativeTime(activeSession.updatedAt)} · ${activeSession.messageCount} 条`
                  : ''}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-1.5">
            <div className="mb-1 flex gap-1">
              <button
                className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-clay transition-colors hover:bg-accent"
                onClick={() => {
                  setSessionMenuOpen(false)
                  onCreateSession()
                }}
              >
                <MessageSquarePlus className="h-4 w-4" /> 新建会话
              </button>
              <button
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-clay"
                title="备份全部会话为 ZIP（每会话一个 JSON，可整包或单个恢复）"
                onClick={() => {
                  setSessionMenuOpen(false)
                  onExportAllSessions()
                }}
              >
                <Archive className="h-3.5 w-3.5" /> 备份
              </button>
              <button
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-clay"
                title="导入会话备份：.json 单会话 / .zip 批量恢复"
                onClick={() => importInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" /> 导入
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json,application/zip,.zip"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) onImportSessionJson(file)
                  e.target.value = '' // 同一文件可重复导入
                  setSessionMenuOpen(false)
                }}
              />
            </div>
            <div className="pb-1">
              <Input
                value={sessionFilter}
                onChange={(e) => setSessionFilter(e.target.value)}
                placeholder="搜索会话…"
                className="h-7 bg-secondary/50 text-[12.5px]"
              />
            </div>
            {sessions.length > 1 && (
              <div className="px-2 pb-1 text-[10.5px] text-muted-foreground">
                {sessionFilter.trim()
                  ? `${filteredSessions.length} / ${sessions.length} 个会话`
                  : `共 ${sessions.length} 个会话`}
              </div>
            )}
            <div className="thin-scrollbar max-h-64 overflow-y-auto">
              {filteredSessions.length === 0 ? (
                <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">
                  {sessions.length === 0 ? '还没有会话' : '没有匹配的会话'}
                </p>
              ) : (
              filteredSessions.map((session, idx) => {
                const prev = idx > 0 ? filteredSessions[idx - 1] : null
                const showDivider = Boolean(prev?.pinned) && !session.pinned
                return (
                  <Fragment key={session.id}>
                    {showDivider && (
                      <div className="mx-2 my-1 border-t border-border/60" />
                    )}
                    <div
                      data-session-row={session.id}
                      className={`group/session flex items-center rounded-md pr-0.5 transition-colors ${
                        session.id === activeSessionId ? 'bg-clay/10' : 'hover:bg-accent'
                      }`}
                    >
                      {inlineRenameId === session.id ? (
                        /* 行内重命名：替换标题按钮，避免嵌套交互；Enter 保存 / Esc 或失焦取消 */
                        <div
                          className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <Check className="h-3.5 w-3.5 shrink-0 text-clay" />
                          <Input
                            value={inlineRenameValue}
                            onChange={(e) => setInlineRenameValue(e.target.value)}
                            className="h-6 flex-1 rounded border-border px-1.5 text-[13px]"
                            maxLength={60}
                            autoFocus
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const v = inlineRenameValue.trim()
                                if (v && v !== session.title) void onRenameSession(session.id, v)
                                setInlineRenameId(null)
                              } else if (e.key === 'Escape') {
                                setInlineRenameId(null)
                              }
                            }}
                            onBlur={() => setInlineRenameId(null)}
                          />
                        </div>
                      ) : (
                        <button
                          className="min-w-0 flex-1 px-2 py-1.5 text-left text-[13px]"
                          onClick={() => {
                            setSessionMenuOpen(false)
                            onSwitchSession(session.id)
                          }}
                        >
                          <span className="flex items-center gap-1.5">
                            {session.id === activeSessionId ? (
                              <Check className="h-3.5 w-3.5 shrink-0 text-clay" />
                            ) : (
                              <span className="h-3.5 w-3.5 shrink-0" />
                            )}
                            <span
                              className={`truncate ${
                                session.id === activeSessionId
                                  ? 'font-medium text-clay'
                                  : 'text-foreground/85'
                              }`}
                            >
                              {session.title}
                            </span>
                            {session.pinned && (
                              <Pin className="h-3 w-3 shrink-0 fill-current text-clay" />
                            )}
                            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                              {mounted ? `${formatRelativeTime(session.updatedAt)} · ${session.messageCount} 条` : ''}
                            </span>
                          </span>
                          {mounted && sessionPreview(session.lastMessage) && (
                            <span className="mt-0.5 block truncate pl-5 text-[11px] leading-tight text-muted-foreground/70">
                              {sessionPreview(session.lastMessage)}
                            </span>
                          )}
                        </button>
                      )}
                      <div className="flex shrink-0 items-center">
                        {session.pinned && (
                          <button
                            className="flex h-6 w-6 items-center justify-center rounded hover:bg-background"
                            title="取消置顶"
                            onClick={() => onTogglePin(session.id, false)}
                          >
                            <Pin className="h-3 w-3 fill-current text-clay" />
                          </button>
                        )}
                        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/session:opacity-100">
                          {!session.pinned && (
                            <button
                              className="flex h-6 w-6 items-center justify-center rounded hover:bg-background"
                              title="置顶会话"
                              onClick={() => onTogglePin(session.id, true)}
                            >
                              <Pin className="h-3 w-3 text-muted-foreground" />
                            </button>
                          )}
                          <button
                            className="flex h-6 w-6 items-center justify-center rounded hover:bg-background"
                            title="重命名"
                            onClick={() => {
                              setInlineRenameId(session.id)
                              setInlineRenameValue(session.title)
                            }}
                          >
                            <Pencil className="h-3 w-3 text-muted-foreground" />
                          </button>
                          <button
                            className="flex h-6 w-6 items-center justify-center rounded hover:bg-background"
                            title="导出 JSON 备份（含全部消息）"
                            onClick={() => onExportSessionJson(session.id)}
                          >
                            <Download className="h-3 w-3 text-muted-foreground" />
                          </button>
                          <button
                            className="flex h-6 w-6 items-center justify-center rounded hover:bg-background"
                            title="克隆会话（复制全部消息为新会话）"
                            disabled={loading}
                            onClick={() => onDuplicateSession(session.id)}
                          >
                            <CopyPlus className="h-3 w-3 text-muted-foreground" />
                          </button>
                          <button
                            className="flex h-6 w-6 items-center justify-center rounded hover:bg-background"
                            title="删除会话"
                            onClick={() => setDeleteTarget(session)}
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </Fragment>
                )
              })
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7 shrink-0"
          onClick={() => {
            setSessionMenuOpen(false)
            onCreateSession()
          }}
          disabled={loading}
          aria-label="新建会话"
          title="新建会话"
        >
          <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => {
            setSearchOpen((v) => !v)
            setSearchQuery('')
          }}
          aria-label="在当前会话中搜索消息"
          title="在当前会话中搜索消息"
          data-active={searchOpen}
        >
          <Search className={`h-3.5 w-3.5 ${searchOpen ? 'text-clay' : 'text-muted-foreground'}`} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onExportChat}
          disabled={loading || messages.length === 0}
          aria-label="导出当前会话为 Markdown"
          title="导出当前会话为 Markdown"
        >
          <Download className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onClear}
          disabled={loading}
          aria-label="清空当前会话对话"
          title="清空当前会话对话"
        >
          <Eraser className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>

      {/* 会话内消息搜索条 */}
      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (setSearchOpen(false), setSearchQuery(''))}
            placeholder="在当前会话中搜索消息…"
            className="h-7 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0"
            autoFocus
          />
          {searching && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {visibleMessages.length} 条匹配
            </span>
          )}
          <button
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-accent"
            onClick={() => {
              setSearchOpen(false)
              setSearchQuery('')
            }}
            aria-label="关闭搜索"
            title="关闭搜索"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* 消息列表（外层 relative 承载「回到底部」悬浮按钮，内层滚动） */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={handleListScroll}
          className="thin-scrollbar h-full space-y-4 overflow-y-auto px-3 py-4"
        >
        {visibleMessages.length === 0 && !loading && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            {searching ? (
              <>
                <Search className="h-6 w-6 text-clay/60" />
                <p className="font-claude-serif text-sm text-foreground/70">没有匹配的消息</p>
                <p className="max-w-[220px] text-xs text-muted-foreground">
                  换个关键词试试，或点击搜索框右侧 × 退出搜索
                </p>
              </>
            ) : (
              <>
                <Sparkles className="h-7 w-7 text-clay/60" />
                <p className="font-claude-serif text-base text-foreground/80">今天想构建点什么？</p>
                <p className="max-w-[260px] text-xs text-muted-foreground">
                  描述你的想法，AI 会直接在工作区创建与修改文件；输入 @ 可引用文件作为上下文
                </p>
                <div className="mt-2 grid w-full max-w-[300px] gap-1.5">
                  {STARTER_PROMPTS.map((p) => (
                    <button
                      key={p.label}
                      className="group rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-clay/40 hover:bg-clay/5"
                      onClick={() => {
                        setInput(p.prompt)
                        textareaRef.current?.focus()
                      }}
                    >
                      <span className="block text-[12.5px] font-medium text-foreground/85 transition-colors group-hover:text-clay">
                        {p.label}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {p.prompt}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {visibleMessages.map((msg, idx) => (
          <div key={msg.id} data-message-id={msg.id} className="group/msg">
            <div className="flex gap-2.5">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                  msg.role === 'assistant' ? 'bg-clay/12' : 'bg-secondary'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <Sparkles className="h-3.5 w-3.5 text-clay" />
                ) : (
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </div>
              <div
                className={`min-w-0 max-w-[calc(100%-42px)] rounded-xl px-3 py-2 ${
                  msg.role === 'assistant'
                    ? 'bg-card text-foreground'
                    : editingId === msg.id
                      ? 'w-full max-w-none border border-clay/50 bg-card'
                      : 'bg-clay/10 text-foreground'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <>
                    <AiMessage
                      content={
                        isStreaming(msg.id)
                          ? msg.content + (msg.content ? ' ▍' : '▍')
                          : msg.content
                      }
                      onApplyCode={isStreaming(msg.id) ? undefined : onApplyCode}
                      applyDisabled={files.length === 0}
                      onSaveAsCode={isStreaming(msg.id) ? undefined : onSaveAsCode}
                      onInsertCode={isStreaming(msg.id) ? undefined : onInsertCode}
                      insertDisabled={!activeFilePath}
                      onApplyAll={isStreaming(msg.id) ? undefined : onApplyAll}
                      showBatchTools={!isStreaming(msg.id)}
                      streaming={isStreaming(msg.id)}
                      onToggleTask={
                        isStreaming(msg.id) || !onToggleTaskContent
                          ? undefined
                          : (newContent) => onToggleTaskContent(msg.id, newContent, msg.content)
                      }
                      knownFiles={files.map((f) => ({ id: f.id, path: f.path }))}
                      onOpenFile={onOpenFile}
                    />
                    {isStreaming(msg.id) && elapsedSec !== null && (
                      <div
                        className="mt-1 flex items-center gap-1.5 text-[10.5px] text-muted-foreground/70"
                        aria-live="off"
                      >
                        <Loader2 className="h-3 w-3 animate-spin text-clay" />
                        {msg.content
                          ? `生成中 · ${msg.content.length} 字`
                          : elapsedSec !== null
                            ? `生成中 · ${elapsedSec}s`
                            : '生成中…'}
                      </div>
                    )}
                  </>
                ) : editingId === msg.id ? (
                  /* 内联编辑用户消息 */
                  <div>
                    <Textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelEdit()
                        } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault()
                          submitEdit()
                        }
                      }}
                      className="min-h-[64px] resize-none border-0 bg-transparent text-[13.5px] focus-visible:ring-0"
                      autoFocus
                    />
                    <div className="mt-1 flex items-center justify-end gap-1.5">
                      <span className="mr-auto text-[10.5px] text-muted-foreground">
                        保存并重发将丢弃此消息之后的所有对话
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2.5 text-xs"
                        onClick={cancelEdit}
                      >
                        取消
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={submitEdit}
                        disabled={!editingText.trim()}
                      >
                        保存并重发
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">
                    {searching
                      ? highlightText(msg.content, searchQuery.trim())
                      : renderMentions(msg.content)}
                  </p>
                )}
                {/* 用户消息图片附件：缩略图行，点击放大预览 */}
                {msg.role === 'user' && msg.attachments && msg.attachments.length > 0 && (
                  <div className={"mt-1.5 flex flex-wrap gap-2" + (editingId === msg.id ? " opacity-60" : "")}>
                    {msg.attachments.map((url, i) => (
                      <button
                        key={`${i}-${url.slice(-16)}`}
                        className="overflow-hidden rounded-md border border-border transition-opacity hover:opacity-90"
                        onClick={() => url && setPreviewImage(url)}
                        title="点击放大"
                        aria-label={`放大查看附件图片 ${i + 1}`}
                      >
                        <img
                          src={url}
                          alt={`附件图片 ${i + 1}`}
                          className="h-20 w-20 object-cover"
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* 悬浮操作行：AI 回复复制 + 重新生成（仅最后一条）；用户消息编辑（搜索过滤态下隐藏，索引已失真） */}
            {!searching && (msg.role === 'assistant' && !isStreaming(msg.id) ? (
              <div className="ml-[38px] mt-1 flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover/msg:opacity-100">
                <span
                  className="mr-1 shrink-0 text-[10.5px] text-muted-foreground/80"
                  title={mounted ? new Date(msg.createdAt).toLocaleString('zh-CN') : undefined}
                >
                  {mounted ? formatMsgTime(msg.createdAt) : ''}
                </span>
                {msg.role === 'assistant' && msg.interrupted && (
                  <span
                    className="mr-1 shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400"
                    title="已手动停止生成，以下为已生成的部分内容"
                  >
                    已中断
                  </span>
                )}
                {typeof msg.durationMs === 'number' && (
                  <>
                    <span
                      className="mr-0.5 shrink-0 text-[10.5px] text-muted-foreground/60"
                      title="本次生成耗时"
                    >
                      · {(msg.durationMs / 1000).toFixed(1)}s
                    </span>
                    {msg.content.length > 0 && (
                      <span
                        className="mr-1 shrink-0 text-[10.5px] text-muted-foreground/60"
                        title="本次生成字数"
                      >
                        · {msg.content.length.toLocaleString()} 字
                      </span>
                    )}
                  </>
                )}
                <button
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-clay"
                  onClick={() => void copyMessage(msg)}
                  title="复制回复原文（Markdown）"
                >
                  {copiedId === msg.id ? (
                    <>
                      <Check className="h-3 w-3 text-green-600" />
                      已复制
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      复制
                    </>
                  )}
                </button>
                <button
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-clay"
                  onClick={() => quoteMessage(msg.content)}
                  title="引用此回复到输入框，便于针对性追问"
                >
                  <Quote className="h-3 w-3" />
                  引用
                </button>
                {idx === lastMsgIndex && canRegenerate && (
                  <button
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-clay"
                    onClick={onRegenerate}
                    title="删除当前回复并重新生成"
                  >
                    <RefreshCw className="h-3 w-3" />
                    重新生成
                  </button>
                )}
                {canEdit(msg) && renderDeleteBtn(msg)}
              </div>
            ) : msg.role === 'user' && editingId !== msg.id && canEdit(msg) ? (
              <div className="ml-[38px] mt-1 flex items-center opacity-100 transition-opacity md:opacity-0 md:group-hover/msg:opacity-100">
                <span
                  className="mr-1 shrink-0 text-[10.5px] text-muted-foreground/80"
                  title={mounted ? new Date(msg.createdAt).toLocaleString('zh-CN') : undefined}
                >
                  {mounted ? formatMsgTime(msg.createdAt) : ''}
                </span>
                <button
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-clay"
                  onClick={() => startEdit(msg)}
                  title="编辑此消息并重发（之后的对话将被丢弃）"
                >
                  <Pencil className="h-3 w-3" />
                  编辑
                </button>
                <button
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-clay"
                  onClick={() => void copyMessage(msg)}
                  title="复制原文"
                >
                  {copiedId === msg.id ? (
                    <>
                      <Check className="h-3 w-3 text-green-600" />
                      已复制
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      复制
                    </>
                  )}
                </button>
                {renderDeleteBtn(msg)}
              </div>
            ) : null)}
          </div>
        ))}

        {loading && !messages.some((m) => isStreaming(m.id)) && (
          <div className="flex gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-clay/12">
              <Sparkles className="h-3.5 w-3.5 text-clay" />
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-card px-3 py-2.5 text-[13px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-clay" />
              正在思考…
              {elapsedSec !== null && elapsedSec > 0 && <span className="tabular-nums">{elapsedSec}s</span>}
            </div>
          </div>
        )}
      </div>
        {/* 用户向上翻阅历史时出现，点击回到底部并恢复跟随 */}
        {showJumpButton && (
          <button
            className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11.5px] text-foreground/80 shadow-md transition-colors hover:border-clay/50 hover:text-clay"
            onClick={jumpToBottom}
          >
            <ArrowDown className="h-3 w-3" />
            回到底部
            {loading && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-clay" />}
          </button>
        )}
      </div>

      {/* 快捷指令 */}
      <div className="flex flex-wrap gap-1.5 px-3 pb-2">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            className="rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] text-foreground/75 transition-colors hover:border-clay/50 hover:text-clay disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => send(action.prompt, true)}
            disabled={loading || !activeFilePath}
            title={activeFilePath ? action.prompt : '请先打开一个文件'}
          >
            {action.label}
          </button>
        ))}
      </div>

      {/* 输入区 */}
      <div className="px-3 pb-3">
        <div className="relative rounded-xl border border-border bg-card shadow-sm transition-colors focus-within:border-clay/60">
          {/* 拖拽把手：向上拖增大输入框高度，双击复位（200px） */}
          <div
            className="group/handle absolute inset-x-0 top-0 z-10 flex h-3 cursor-row-resize items-start justify-center touch-none"
            onPointerDown={startResize}
            onDoubleClick={() => {
              setInputMaxH(200)
              try {
                localStorage.setItem(INPUT_MAX_H_KEY, '200')
              } catch {
                /* 存储不可用时静默 */
              }
            }}
            role="separator"
            aria-orientation="horizontal"
            aria-label="拖拽调整输入框高度，双击复位"
            title="拖拽调整输入框高度 · 双击复位"
          >
            <span className="mt-0.5 h-1 w-10 rounded-full bg-border transition-colors group-hover/handle:bg-clay/60" />
          </div>
          {activeFilePath && (
            <div className="flex items-center gap-2 px-3 pt-2.5">
              <span
                className={`flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors ${
                  fileAttached
                    ? 'border-clay/40 bg-clay/10 text-clay'
                    : 'border-border bg-secondary/60 text-muted-foreground'
                }`}
              >
                <Paperclip className="h-3 w-3 shrink-0" />
                <FileCode2 className="h-3 w-3 shrink-0" />
                <span className="truncate font-mono">{activeFilePath}</span>
                <button
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-background/70"
                  title={fileAttached ? '不把此文件发给 AI' : '重新附加此文件'}
                  aria-label={fileAttached ? '移除文件上下文' : '附加文件上下文'}
                  onClick={() => setFileAttached((v) => !v)}
                >
                  {fileAttached ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                </button>
              </span>
              <span className="shrink-0 text-[10.5px] text-muted-foreground">
                {fileAttached ? 'AI 将读取该文件' : '已移除，AI 看不到该文件'}
              </span>
            </div>
          )}
          {mentions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
              {mentions.map((m) => (
                <span
                  key={m.id}
                  className="flex max-w-full items-center gap-1 rounded-md border border-clay/40 bg-clay/10 px-1.5 py-0.5 text-[11px] text-clay"
                >
                  <AtSign className="h-3 w-3 shrink-0" />
                  <span className="truncate font-mono">{m.path}</span>
                  <button
                    className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-background/70"
                    title="移除引用（AI 将看不到该文件）"
                    aria-label={`移除引用 ${m.path}`}
                    onClick={() => setMentions((prev) => prev.filter((x) => x.id !== m.id))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {/* 待发送图片附件预览 */}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5">
              {pendingAttachments.map((url, i) => (
                <span
                  key={`${i}-${url.slice(-16)}`}
                  className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border"
                >
                  {url ? (
                    <img src={url} alt={`待发送图片 ${i + 1}`} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-muted">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </span>
                  )}
                  <button
                    className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-colors hover:bg-destructive hover:text-white"
                    title="移除这张图片"
                    aria-label={`移除图片 ${i + 1}`}
                    onClick={() => setPendingAttachments((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              <span className="text-[10.5px] text-muted-foreground">
                {pendingAttachments.filter(Boolean).length}/{MAX_PENDING_IMAGES} 张图片将随消息发送
              </span>
            </div>
          )}
          {/* @ 文件引用下拉 */}
          {mentionOpen && (
            <div className="absolute bottom-full left-3 right-3 z-10 mb-1 overflow-hidden rounded-lg border border-border bg-card shadow-md">
              <div className="border-b border-border/60 px-2.5 py-1 text-[10.5px] text-muted-foreground">
                引用文件作为 AI 上下文（↑↓ 选择 · Enter 确认 · Esc 关闭）
              </div>
              <div className="thin-scrollbar max-h-[min(13rem,32vh)] overflow-y-auto p-1">
                {mentionMatches.length === 0 ? (
                  <p className="px-2 py-2 text-[12px] text-muted-foreground">没有匹配的文件</p>
                ) : (
                  mentionMatches.map((f, i) => (
                    <button
                      key={f.id}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12.5px] transition-colors md:py-1.5 ${
                        i === mentionIndex ? 'bg-clay/10 text-clay' : 'text-foreground/85 hover:bg-accent'
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        pickMention(f)
                      }}
                      onMouseEnter={() => setMentionIndex(i)}
                    >
                      <FileCode2 className="h-3.5 w-3.5 shrink-0 text-clay" />
                      <span className="truncate font-mono">{f.path}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onBlur={() => {
              // 延迟关闭，避免点击下拉项时误收起（下拉项用 mousedown + preventDefault 保持焦点）
              setTimeout(() => setMentionOpen(false), 120)
            }}
            placeholder={
              activeFilePath
                ? `询问 AI，或让它修改 ${activeFilePath}…（@ 引用文件，Enter 发送）`
                : '向 AI 描述你的需求…（输入 @ 引用文件作为上下文）'
            }
            style={{ maxHeight: `${inputMaxH}px` }}
            className="min-h-[72px] resize-none overflow-y-auto border-0 bg-transparent pr-[4.75rem] text-[13.5px] focus-visible:ring-0"
          />
          {loading ? (
            <Button
              size="icon"
              variant="secondary"
              className="absolute bottom-2.5 right-2.5 h-8 w-8 rounded-lg border border-border"
              onClick={onStop}
              aria-label="停止生成"
              title="停止生成"
            >
              <Square className="h-3 w-3 fill-current text-clay" />
            </Button>
          ) : (
            <>
              <Button
                size="icon"
                variant="secondary"
                className="absolute bottom-2.5 right-[3.25rem] h-8 w-8 rounded-lg border border-border"
                onClick={() => imageInputRef.current?.click()}
                disabled={pendingAttachments.length >= MAX_PENDING_IMAGES}
                aria-label="添加图片"
                title="添加图片（也可直接粘贴截图）"
              >
                <ImagePlus className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button
                size="icon"
                className="absolute bottom-2.5 right-2.5 h-8 w-8 rounded-lg"
                onClick={() => send(input)}
                disabled={!input.trim() && pendingAttachments.filter(Boolean).length === 0}
                aria-label="发送"
              >
                <SendHorizonal className="h-4 w-4" />
              </Button>
            </>
          )}
          {/* 隐藏的图片选择 input（同一文件可重复选） */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void addImageFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      {/* 附件大图预览 */}
      <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="max-w-3xl p-2" aria-label="附件图片预览">
          {previewImage && (
            <img
              src={previewImage}
              alt="附件图片预览"
              className="max-h-[75vh] w-full rounded-md object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 删除会话确认 */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-claude-serif">删除会话？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除「{deleteTarget?.title}」及其全部对话记录，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                if (deleteTarget) onDeleteSession(deleteTarget.id)
                setDeleteTarget(null)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
