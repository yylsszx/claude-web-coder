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

/** POST /api/sessions —— 新建会话 */
export async function POST(_request: NextRequest) {
  try {
    const session = await db.chatSession.create({ data: { title: '新会话' } })
    return NextResponse.json(
      { session: { id: session.id, title: session.title, messageCount: 0 } },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/sessions failed:', error)
    return NextResponse.json({ error: '创建会话失败' }, { status: 500 })
  }
}
