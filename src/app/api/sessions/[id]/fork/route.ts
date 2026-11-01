import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/sessions/[id]/fork —— 从指定消息分叉新会话
 * body: { messageId }；复制标题（加「· 分叉」后缀）与该消息及其之前的全部消息（保持原顺序、原文与原时间），
 * 之后的消息不带入。源会话不受影响。
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const messageId: unknown = body?.messageId
    if (typeof messageId !== 'string' || !messageId) {
      return NextResponse.json({ error: '缺少 messageId' }, { status: 400 })
    }

    const source = await db.chatSession.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    if (!source) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 })
    }
    // 切分点以服务端返回的消息数组下标为准（与前端渲染同一份顺序，自洽）
    const idx = source.messages.findIndex((m) => m.id === messageId)
    if (idx === -1) {
      return NextResponse.json({ error: '消息不存在于该会话' }, { status: 404 })
    }
    const kept = source.messages.slice(0, idx + 1)

    // 标题与源会话/其他分叉重名时难区分，统一追加「· 分叉」；超长截断到 60 字（与 PATCH 重命名同一上限）
    const fork = await db.chatSession.create({
      data: {
        title: `${source.title} · 分叉`.slice(0, 60),
        messages: {
          create: kept.map((m) => ({
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
            attachments: m.attachments,
          })),
        },
      },
    })
    return NextResponse.json(
      { session: { id: fork.id, title: fork.title, messageCount: kept.length } },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/sessions/[id]/fork failed:', error)
    return NextResponse.json({ error: '分叉会话失败' }, { status: 500 })
  }
}
