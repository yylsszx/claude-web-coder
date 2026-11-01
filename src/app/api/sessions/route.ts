import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/** GET /api/sessions —— 会话列表（按最近更新排序，含消息数与最后一条消息摘要） */
export async function GET() {
  try {
    const sessions = await db.chatSession.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { messages: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true } },
      },
    })
    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        pinned: s.pinned,
        messageCount: s._count.messages,
        updatedAt: s.updatedAt,
        lastMessage: s.messages[0]?.content ?? undefined,
      })),
    })
  } catch (error) {
    console.error('GET /api/sessions failed:', error)
    return NextResponse.json({ error: '获取会话列表失败' }, { status: 500 })
  }
}

/** POST /api/sessions —— 新建会话；带 {title, messages} 时为导入（事务式建会话 + 批量写消息） */
export async function POST(request: NextRequest) {
  try {
    // 兼容旧调用（无 body）：新建空会话
    let body: { title?: unknown; messages?: unknown } = {}
    try {
      body = await request.json()
    } catch {
      /* 无 body / 非 JSON：走新建空会话 */
    }
    const hasPayload =
      body &&
      (body.title !== undefined || body.messages !== undefined)

    if (!hasPayload) {
      const session = await db.chatSession.create({ data: { title: '新会话' } })
      return NextResponse.json(
        { session: { id: session.id, title: session.title, messageCount: 0 } },
        { status: 201 }
      )
    }

    // 导入模式：校验并过滤消息（角色 / 非空内容），上限 500 条防止单请求过大
    const title =
      typeof body.title === 'string' && body.title.trim()
        ? body.title.trim().slice(0, 60)
        : '导入的会话'
    const rawMessages = Array.isArray(body.messages) ? body.messages : []
    if (rawMessages.length === 0) {
      return NextResponse.json({ error: '没有可导入的消息' }, { status: 400 })
    }
    if (rawMessages.length > 500) {
      return NextResponse.json(
        { error: '消息数超出上限（最多 500 条）' },
        { status: 400 }
      )
    }
    // 记录每条原始消息的 createdAt（对象引用为键），过滤后仍能对应还原时间
    const rawCreatedAts = new Map<object, string | number | Date>()
    for (const m of rawMessages) {
      if (m && typeof m === 'object') {
        const c = (m as { createdAt?: unknown }).createdAt
        if (typeof c === 'string' || typeof c === 'number' || c instanceof Date) {
          rawCreatedAts.set(m, c)
        }
      }
    }
    const messages = rawMessages
      .filter(
        (m): m is { role: 'user' | 'assistant'; content: string } =>
          !!m &&
          typeof m === 'object' &&
          ((m as { role?: unknown }).role === 'user' ||
            (m as { role?: unknown }).role === 'assistant') &&
          typeof (m as { content?: unknown }).content === 'string' &&
          ((m as { content: string }).content.trim().length > 0)
      )
      .map((m) => {
        // 尽量还原原始时间（可解析时），否则用默认 now
        const raw = rawCreatedAts.get(m)
        const t = raw !== undefined ? new Date(raw) : null
        return {
          role: m.role,
          content: m.content,
          ...(t && !Number.isNaN(t.getTime()) ? { createdAt: t } : {}),
        }
      })
    if (messages.length === 0) {
      return NextResponse.json(
        { error: '没有有效的消息（需含 role 与非空 content）' },
        { status: 400 }
      )
    }

    const session = await db.$transaction(async (tx) => {
      const s = await tx.chatSession.create({ data: { title } })
      await tx.chatMessage.createMany({
        data: messages.map((m) => ({
          sessionId: s.id,
          role: m.role,
          content: m.content,
          ...(m.createdAt ? { createdAt: m.createdAt } : {}),
        })),
      })
      return s
    })
    return NextResponse.json(
      {
        session: {
          id: session.id,
          title: session.title,
          messageCount: messages.length,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/sessions failed:', error)
    return NextResponse.json({ error: '创建会话失败' }, { status: 500 })
  }
}
