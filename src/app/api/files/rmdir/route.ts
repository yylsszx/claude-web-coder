import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * DELETE /api/files/rmdir —— 删除整个目录（含全部子文件）
 *
 * body: { dirPath: string }
 * - dirPath 被删除的目录（不带尾斜杠，如 'src/lib'）
 *
 * 规则：
 * - 删除路径前缀 `${dirPath}/` 下的全部文件（子树整体删除，不可恢复）
 * - 目录不存在或为空（无该前缀文件）返回 404
 * - 返回 { deleted: n }，打开中的标签由页面侧负责关闭
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as { dirPath?: unknown }
    const dirPath =
      typeof body.dirPath === 'string' ? body.dirPath.trim().replace(/^\/+|\/+$/g, '') : ''

    if (!dirPath || dirPath.includes('..')) {
      return NextResponse.json({ error: '目录路径不合法' }, { status: 400 })
    }

    const prefix = `${dirPath}/`
    const found = await db.projectFile.findMany({
      where: { path: { startsWith: prefix } },
      select: { id: true },
    })
    if (found.length === 0) {
      return NextResponse.json({ error: '目录不存在或为空' }, { status: 404 })
    }

    await db.projectFile.deleteMany({ where: { path: { startsWith: prefix } } })

    return NextResponse.json({ deleted: found.length })
  } catch (error) {
    console.error('DELETE /api/files/rmdir failed:', error)
    return NextResponse.json({ error: '删除文件夹失败' }, { status: 500 })
  }
}
