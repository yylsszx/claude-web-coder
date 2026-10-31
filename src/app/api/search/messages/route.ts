import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/** 最多返回的消息条数 */
const MAX_MESSAGES = 15
/** 候选消息抓取上限（超出部分不参与搜索，保护查询规模） */
const MAX_CANDIDATES = 300
/** 摘要最大长度 */
const SNIPPET_MAX_LEN = 200

interface MessageSearchItem {
  messageId: string
  sessionId: string
  sessionTitle: string
  role: string
  /** 首处命中位置的上下文摘要（压缩空白，前后越界加省略号） */
  snippet: string
  /** 该条消息内的命中次数 */
  matchCount: number
  createdAt: string
}

/**
 * GET /api/search/messages?q=xxx —— 跨会话搜索对话消息内容
 * SQLite 的 contains 映射为 LIKE（ASCII 大小写不敏感），中文不受影响；
 * 取最近候选后逐条精确计数，按消息时间倒序返回前 MAX_MESSAGES 条
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
  if (!q) {
    return Response.json({ results: [] })
  }

  const msgs = await db.chatMessage.findMany({
    where: { content: { contains: q } },
    include: { session: { select: { title: true } } },
    orderBy: { createdAt: 'desc' },
    take: MAX_CANDIDATES,
  })

  const lowerQ = q.toLowerCase()
  const results: MessageSearchItem[] = []

  for (const m of msgs) {
    const lower = m.content.toLowerCase()
    let matchCount = 0
    let snippet = ''
    let idx = lower.indexOf(lowerQ)
    while (idx !== -1) {
      matchCount++
      if (!snippet) {
        // 首处命中：向前取 60 字上下文、向后取到命中结束再留 80 字
        const start = Math.max(0, idx - 60)
        const end = Math.min(m.content.length, idx + lowerQ.length + 80)
        const raw = m.content.slice(start, end).replace(/\s+/g, ' ').trim()
        snippet = (start > 0 ? '…' : '') + raw.slice(0, SNIPPET_MAX_LEN) + (end < m.content.length ? '…' : '')
      }
      idx = lower.indexOf(lowerQ, idx + lowerQ.length)
    }
    if (matchCount === 0) continue
    results.push({
      messageId: m.id,
      sessionId: m.sessionId,
      sessionTitle: m.session.title,
      role: m.role,
      snippet,
      matchCount,
      createdAt: m.createdAt.toISOString(),
    })
    if (results.length >= MAX_MESSAGES) break
  }

  return Response.json({ results })
}
