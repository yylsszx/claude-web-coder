import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { inferLanguage } from '@/lib/language'

type RouteContext = { params: Promise<{ id: string }> }

/** GET /api/files/[id] —— 读取单个文件（含内容） */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const file = await db.projectFile.findUnique({ where: { id } })
    if (!file) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 })
    }
    return NextResponse.json({ file })
  } catch (error) {
    console.error('GET /api/files/[id] failed:', error)
    return NextResponse.json({ error: '读取文件失败' }, { status: 500 })
  }
}

/** PUT /api/files/[id] —— 更新内容或重命名 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = await request.json()

    const existing = await db.projectFile.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 })
    }

    const data: { content?: string; path?: string; language?: string } = {}

    if (typeof body.content === 'string') {
      data.content = body.content
    }
    if (typeof body.path === 'string' && body.path.trim()) {
      const normalized = body.path.trim().replace(/^\/+/, '')
      if (normalized.includes('..')) {
        return NextResponse.json({ error: '文件路径不合法' }, { status: 400 })
      }
      if (normalized !== existing.path) {
        const conflict = await db.projectFile.findUnique({ where: { path: normalized } })
        if (conflict) {
          return NextResponse.json({ error: '目标文件名已存在' }, { status: 409 })
        }
        data.path = normalized
        data.language = inferLanguage(normalized)
      }
    }

    const file = await db.projectFile.update({ where: { id }, data })
    return NextResponse.json({ file })
  } catch (error) {
    console.error('PUT /api/files/[id] failed:', error)
    return NextResponse.json({ error: '保存文件失败' }, { status: 500 })
  }
}

/** DELETE /api/files/[id] —— 删除文件 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    await db.projectFile.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/files/[id] failed:', error)
    return NextResponse.json({ error: '删除文件失败' }, { status: 500 })
  }
}
