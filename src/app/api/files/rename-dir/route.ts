import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * POST /api/files/rename-dir —— 目录原位重命名（只改最后一段名称）
 *
 * body: { dirPath: string, newBase: string }
 * - dirPath 被重命名的目录（不带尾斜杠，如 'src/lib'）
 * - newBase 新的最后一段名称（不允许包含 '/'，如 'utils'）
 *
 * 规则（与 move-dir 同一套批量前缀替换语义）：
 * - 前缀 `${dirPath}/` 整体替换为 `${parent(dirPath)}/${newBase}/`，子树相对结构原样保留
 * - 目录不存在或为空（无该前缀文件）返回 404
 * - newBase 与原名相同（no-op）返回 { renamed: 0 }
 * - 任一新路径与「不在本次集合内的现有文件」冲突时 409 整体拒绝（不产生半重命名状态）
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { dirPath?: unknown; newBase?: unknown }
    const dirPath =
      typeof body.dirPath === 'string' ? body.dirPath.trim().replace(/^\/+|\/+$/g, '') : ''
    const newBase =
      typeof body.newBase === 'string' ? body.newBase.trim().replace(/^\/+|\/+$/g, '') : ''

    if (
      !dirPath ||
      !newBase ||
      dirPath.includes('..') ||
      newBase.includes('/') ||
      newBase.includes('..')
    ) {
      return NextResponse.json({ error: '目录路径不合法' }, { status: 400 })
    }

    const all = await db.projectFile.findMany({ select: { id: true, path: true } })
    const oldPrefix = `${dirPath}/`
    const moving = all.filter((f) => f.path.startsWith(oldPrefix))
    if (moving.length === 0) {
      return NextResponse.json({ error: '目录不存在或为空' }, { status: 404 })
    }

    const parent = dirPath.split('/').slice(0, -1).join('/')
    const newPrefix = parent ? `${parent}/${newBase}/` : `${newBase}/`
    if (newPrefix === oldPrefix) {
      return NextResponse.json({ renamed: 0 }) // 名称未变化：no-op
    }

    // 冲突检查：任一新路径撞上「不在本次集合内」的现有文件 → 整体拒绝
    const movingIds = new Set(moving.map((m) => m.id))
    const occupied = new Set(all.filter((f) => !movingIds.has(f.id)).map((f) => f.path))
    const clash = moving.find((f) => occupied.has(`${newPrefix}${f.path.slice(oldPrefix.length)}`))
    if (clash) {
      const clashPath = `${newPrefix}${clash.path.slice(oldPrefix.length)}`
      return NextResponse.json({ error: `目标位置已存在同名文件：${clashPath}` }, { status: 409 })
    }

    await db.$transaction(
      moving.map((f) =>
        db.projectFile.update({
          where: { id: f.id },
          data: { path: `${newPrefix}${f.path.slice(oldPrefix.length)}` },
        })
      )
    )

    return NextResponse.json({ renamed: moving.length })
  } catch (error) {
    console.error('POST /api/files/rename-dir failed:', error)
    return NextResponse.json({ error: '重命名目录失败' }, { status: 500 })
  }
}
