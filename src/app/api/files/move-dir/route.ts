import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * POST /api/files/move-dir —— 批量移动目录（文件树目录拖拽）
 *
 * body: { dirPath: string, targetPath: string }
 * - dirPath    被拖动的目录（不带尾斜杠，如 'src/lib'）
 * - targetPath 目标父目录（'' 表示根目录）
 *
 * 规则：
 * - 目录作为整体移动（与文件管理器语义一致）：dirPath 的 basename 拼到目标目录下，
 *   即前缀 `${dirPath}/` 替换为 `${targetPath}/${basename(dirPath)}/`（targetPath 为空时为
 *   `${basename(dirPath)}/`），如拖 `src/lib` 到 `docs` 得到 `docs/lib/…`；文件内容不变
 * - 目标目录是被拖目录自身或其子孙目录时拒绝（拖进自己内部没有意义）
 * - 空目录 / 目录不存在（工作区无该前缀文件）返回 404
 * - 任一新路径与「不在本次移动集合内的现有文件」冲突时 409 整体拒绝（不产生半移动状态）
 * - 前缀替换不会让移动集合内部文件互撞（子树相对结构原样保留）
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { dirPath?: unknown; targetPath?: unknown }
    const dirPath = typeof body.dirPath === 'string' ? body.dirPath.trim().replace(/^\/+|\/+$/g, '') : ''
    const targetPath =
      typeof body.targetPath === 'string' ? body.targetPath.trim().replace(/^\/+|\/+$/g, '') : ''

    if (!dirPath || dirPath.includes('..') || targetPath.includes('..')) {
      return NextResponse.json({ error: '目录路径不合法' }, { status: 400 })
    }
    if (targetPath === dirPath || targetPath.startsWith(`${dirPath}/`)) {
      return NextResponse.json({ error: '不能把目录移动到它自身或其子目录内' }, { status: 400 })
    }

    // 收集被移动目录下全部文件（路径前缀 ${dirPath}/）
    const all = await db.projectFile.findMany({ select: { id: true, path: true } })
    const prefix = `${dirPath}/`
    const moving = all.filter((f) => f.path.startsWith(prefix))
    if (moving.length === 0) {
      return NextResponse.json({ error: '目录不存在或为空' }, { status: 404 })
    }

    const newPrefix =
      targetPath === ''
        ? `${dirPath.split('/').pop()}/` // 移到根：保留自身最后一段（src/lib → lib）
        : `${targetPath}/${dirPath.split('/').pop()}/` // 拖进目录：整体成为其子目录（src/lib → docs/lib）
    const prefixOld = `${dirPath}/`
    if (newPrefix === prefixOld) {
      return NextResponse.json({ moved: 0 }) // 拖回原位置（如根级目录拖到空白）：no-op
    }
    const moves = moving.map((f) => ({ id: f.id, from: f.path, to: `${newPrefix}${f.path.slice(prefixOld.length)}` }))

    // 冲突检查：任一新路径撞上「不在移动集合内」的现有文件 → 整体拒绝
    const movingIds = new Set(moves.map((m) => m.id))
    const occupied = new Set(all.filter((f) => !movingIds.has(f.id)).map((f) => f.path))
    const clash = moves.find((m) => occupied.has(m.to))
    if (clash) {
      return NextResponse.json({ error: `目标位置已存在同名文件：${clash.to}` }, { status: 409 })
    }

    await db.$transaction(
      moves.map((m) => db.projectFile.update({ where: { id: m.id }, data: { path: m.to } }))
    )

    return NextResponse.json({ moved: moves.length })
  } catch (error) {
    console.error('POST /api/files/move-dir failed:', error)
    return NextResponse.json({ error: '移动目录失败' }, { status: 500 })
  }
}
