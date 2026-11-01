import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/files/[id]/versions —— 文件历史快照。
 * 默认：返回快照列表（时间倒序，仅元信息不含 content）。
 * ?versionId=xxx：返回该快照的完整内容（供预览 / 回滚取数）。
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const versionId = request.nextUrl.searchParams.get('versionId')

    if (versionId) {
      const version = await db.fileVersion.findUnique({ where: { id: versionId } })
      if (!version || version.fileId !== id) {
        return NextResponse.json({ error: '历史版本不存在' }, { status: 404 })
      }
      return NextResponse.json({
        version: { id: version.id, content: version.content },
      })
    }

    const file = await db.projectFile.findUnique({ where: { id } })
    if (!file) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 })
    }
    const rows = await db.fileVersion.findMany({
      where: { fileId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, source: true, size: true, createdAt: true },
    })
    const versions = rows.map((v) => ({
      id: v.id,
      source: v.source,
      size: v.size,
      createdAt: v.createdAt.toISOString(),
    }))
    return NextResponse.json({ versions })
  } catch (error) {
    console.error('GET /api/files/[id]/versions failed:', error)
    return NextResponse.json({ error: '读取历史版本失败' }, { status: 500 })
  }
}
