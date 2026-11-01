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

/** 快照来源白名单：manual 手动保存 | ai AI 应用代码 | rollback 回滚 / 撤销应用 */
const SNAPSHOT_SOURCES = new Set(['manual', 'ai', 'rollback'])
/** 每个文件保留的历史快照上限，超出时按时间删最旧 */
const MAX_VERSIONS_PER_FILE = 50

/**
 * PUT /api/files/[id] —— 更新内容或重命名。
 * 内容发生实际变化时自动落一条历史快照（FileVersion，记录新状态与来源），
 * 「更新 + 快照」在同一事务内原子生效；重命名 / 重复保存（内容未变）不产生快照。
 */
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

    // 内容无实际变化（重命名 / 重复保存）不产生快照
    const contentChanged =
      typeof data.content === 'string' && data.content !== existing.content
    const source =
      typeof body.source === 'string' && SNAPSHOT_SOURCES.has(body.source)
        ? body.source
        : 'manual'

    if (contentChanged) {
      const size = Buffer.byteLength(data.content as string, 'utf8')
      const [, file] = await db.$transaction([
        db.fileVersion.create({
          data: { fileId: id, content: data.content as string, source, size },
        }),
        db.projectFile.update({ where: { id }, data }),
      ])
      // 清理超出上限的旧快照（按时间保留最近 50 条）
      const old = await db.fileVersion.findMany({
        where: { fileId: id },
        orderBy: { createdAt: 'desc' },
        skip: MAX_VERSIONS_PER_FILE,
        select: { id: true },
      })
      if (old.length > 0) {
        await db.fileVersion.deleteMany({ where: { id: { in: old.map((v) => v.id) } } })
      }
      return NextResponse.json({ file })
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
