import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/** 统计行数：空串 0 行；去掉末尾换行再按 \n 切分（与 VS Code 行数口径一致） */
function countLines(content: string): number {
  if (content.length === 0) return 0
  return content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
}

/** GET /api/workspace/stats —— 工作区统计（文件/目录数、总行数、总大小、按扩展名分布） */
export async function GET() {
  try {
    const files = await db.projectFile.findMany({
      select: { path: true, content: true, updatedAt: true },
    })

    let bytes = 0
    let lines = 0
    const dirs = new Set<string>()
    const byExt = new Map<string, { count: number; bytes: number; lines: number }>()
    let lastUpdated: Date | null = null

    for (const f of files) {
      const content = f.content ?? ''
      const size = Buffer.byteLength(content, 'utf8')
      bytes += size
      lines += countLines(content)

      // 目录数：取文件路径的目录部分去重（根目录下的文件不计目录）
      const slash = f.path.lastIndexOf('/')
      if (slash > 0) dirs.add(f.path.slice(0, slash))

      // 扩展名分组：最后一个点在目录分隔符之后才算扩展名（.gitkeep 归为无扩展名）
      const dot = f.path.lastIndexOf('.')
      const ext =
        dot > slash && dot < f.path.length - 1 ? f.path.slice(dot + 1).toLowerCase() : '(无扩展名)'
      const agg = byExt.get(ext) ?? { count: 0, bytes: 0, lines: 0 }
      agg.count += 1
      agg.bytes += size
      agg.lines += countLines(content)
      byExt.set(ext, agg)

      if (!lastUpdated || f.updatedAt > lastUpdated) lastUpdated = f.updatedAt
    }

    const byExtList = [...byExt.entries()]
      .map(([ext, v]) => ({ ext, ...v }))
      .sort((a, b) => b.count - a.count || b.bytes - a.bytes)
      .slice(0, 12)

    return NextResponse.json({
      files: files.length,
      dirs: dirs.size,
      bytes,
      lines,
      lastUpdated: lastUpdated ? lastUpdated.toISOString() : null,
      byExt: byExtList,
    })
  } catch (error) {
    console.error('GET /api/workspace/stats 失败:', error)
    return NextResponse.json({ error: '统计工作区失败' }, { status: 500 })
  }
}
