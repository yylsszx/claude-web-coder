import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeed } from '@/lib/seed'
import { inferLanguage } from '@/lib/language'

/** GET /api/files —— 文件列表（不含内容） */
export async function GET() {
  try {
    await ensureSeed()
    const files = await db.projectFile.findMany({
      select: {
        id: true,
        path: true,
        language: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { path: 'asc' },
    })
    return NextResponse.json({ files })
  } catch (error) {
    console.error('GET /api/files failed:', error)
    return NextResponse.json({ error: '获取文件列表失败' }, { status: 500 })
  }
}

/** POST /api/files —— 新建文件 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const path = typeof body.path === 'string' ? body.path.trim() : ''

    if (!path) {
      return NextResponse.json({ error: '文件路径不能为空' }, { status: 400 })
    }
    if (path.includes('..')) {
      return NextResponse.json({ error: '文件路径不合法' }, { status: 400 })
    }

    const normalized = path.replace(/^\/+/, '')
    const exists = await db.projectFile.findUnique({ where: { path: normalized } })
    if (exists) {
      return NextResponse.json({ error: '文件已存在' }, { status: 409 })
    }

    const file = await db.projectFile.create({
      data: {
        path: normalized,
        content: typeof body.content === 'string' ? body.content : '',
        language: inferLanguage(normalized),
      },
    })
    return NextResponse.json({ file }, { status: 201 })
  } catch (error) {
    console.error('POST /api/files failed:', error)
    return NextResponse.json({ error: '创建文件失败' }, { status: 500 })
  }
}
