import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

/** PATCH /api/messages/[id] —— 更新消息内容（当前用于 AI 回复任务列表勾选状态持久化） */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = await request.json()

    const content = typeof body.content === 'string' ? body.content : null
    if (content === null || !content.trim()) {
      return NextResponse.json({ error: '内容不能为空' }, { status: 400 })
    }

    const existing = await db.chatMessage.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: '消息不存在' }, { status: 404 })
    }

    const message = await db.chatMessage.update({ where: { id }, data: { content } })
    return NextResponse.json({ message })
  } catch (error) {
    console.error('PATCH /api/messages/[id] failed:', error)
    return NextResponse.json({ error: '更新消息失败' }, { status: 500 })
  }
}

/** DELETE /api/messages/[id] —— 删除单条消息（会话其余消息不受影响） */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params

    const existing = await db.chatMessage.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: '消息不存在' }, { status: 404 })
    }

    await db.chatMessage.delete({ where: { id } })
    // touch 会话 updatedAt：会话列表摘要与排序即时反映删除后的状态
    await db.chatSession.update({
      where: { id: existing.sessionId },
      data: { updatedAt: new Date() },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/messages/[id] failed:', error)
    return NextResponse.json({ error: '删除消息失败' }, { status: 500 })
  }
}
