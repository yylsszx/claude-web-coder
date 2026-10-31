import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getOrCreateDefaultSession } from '@/lib/session'

type RouteContext = { params: Promise<{ id: string }> }

/** PATCH /api/sessions/[id] —— 重命名会话 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = await request.json()
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) {
      return NextResponse.json({ error: '标题不能为空' }, { status: 400 })
    }
    if (title.length > 60) {
      return NextResponse.json({ error: '标题过长（最多 60 字）' }, { status: 400 })
    }

    const existing = await db.chatSession.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 })
    }

    const session = await db.chatSession.update({ where: { id }, data: { title } })
    return NextResponse.json({ session })
  } catch (error) {
    console.error('PATCH /api/sessions/[id] failed:', error)
    return NextResponse.json({ error: '重命名失败' }, { status: 500 })
  }
}

/** DELETE /api/sessions/[id] —— 删除会话（级联删除消息）；最后一个会话删除后自动重建默认会话 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    await db.chatSession.delete({ where: { id } })

    const remaining = await db.chatSession.count()
    if (remaining === 0) {
      await getOrCreateDefaultSession()
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/sessions/[id] failed:', error)
    return NextResponse.json({ error: '删除会话失败' }, { status: 500 })
  }
}
