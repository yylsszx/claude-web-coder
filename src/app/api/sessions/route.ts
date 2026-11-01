import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSessionImportBody } from '@/lib/session-import'

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

    // 导入模式：共享校验（角色白名单 / 非空内容 / 500 上限 / createdAt 还原）
    const parsed = parseSessionImportBody(body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    }

    const session = await db.$transaction(async (tx) => {
      const s = await tx.chatSession.create({ data: { title: parsed.title } })
      await tx.chatMessage.createMany({
        data: parsed.messages.map((m) => ({
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
          messageCount: parsed.messages.length,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/sessions failed:', error)
    return NextResponse.json({ error: '创建会话失败' }, { status: 500 })
  }
}
