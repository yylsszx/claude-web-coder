import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

/** POST /api/sessions/[id]/clone —— 克隆会话：复制标题（加「（副本）」）与全部消息（保持原顺序、原文与原时间） */
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const source = await db.chatSession.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    if (!source) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 })
    }

    const clone = await db.chatSession.create({
      data: {
        // 标题与源会话重名时下拉里难区分，统一追加（副本）；超长截断到 60 字（与 PATCH 重命名同一上限）
        title: `${source.title}（副本）`.slice(0, 60),
        messages: {
          create: source.messages.map((m) => ({
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
            attachments: m.attachments,
          })),
        },
      },
    })
    return NextResponse.json(
      { session: { id: clone.id, title: clone.title, messageCount: source.messages.length } },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/sessions/[id]/clone failed:', error)
    return NextResponse.json({ error: '克隆会话失败' }, { status: 500 })
  }
}
