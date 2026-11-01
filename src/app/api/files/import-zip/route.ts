import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { db } from '@/lib/db'
import { inferLanguage } from '@/lib/language'

export const runtime = 'nodejs'

/** 上传 ZIP 大小上限 */
const MAX_ZIP_BYTES = 10 * 1024 * 1024
/** 单个解压文件大小上限（文本内容不适合过大） */
const MAX_ENTRY_BYTES = 512 * 1024
/** 单次导入最多创建的文件数 */
const MAX_CREATED = 500

/** 跳过的目录前缀 / 文件名（系统与版本控制噪音） */
const SKIP_DIR_PREFIXES = ['__MACOSX/', '.git/', 'node_modules/']
const SKIP_FILE_NAMES = ['.DS_Store', 'Thumbs.db']

/**
 * POST /api/files/import-zip —— 导入 ZIP 压缩包到工作区。
 * multipart/form-data，字段名 file。规则：
 * - 仅导入文本类文件：含 NUL 字节或无法 UTF-8 解码的（图片 / 二进制）跳过
 * - 跳过 __MACOSX / .git / node_modules 目录与系统垃圾文件
 * - 路径归一化后与工作区冲突的跳过（不覆盖现有文件）
 * - 单文件 > 512KB 跳过，总计最多创建 500 个文件
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '缺少 file 字段' }, { status: 400 })
    }
    if (file.size > MAX_ZIP_BYTES) {
      return NextResponse.json(
        { error: `ZIP 文件过大（上限 ${(MAX_ZIP_BYTES / 1024 / 1024).toFixed(0)}MB）` },
        { status: 400 }
      )
    }

    const buf = Buffer.from(await file.arrayBuffer())
    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(buf)
    } catch {
      return NextResponse.json({ error: '无法解析 ZIP 文件（已损坏或非 ZIP 格式）' }, { status: 400 })
    }

    // 工作区现有路径集合（冲突跳过用）
    const existing = new Set(
      (await db.projectFile.findMany({ select: { path: true } })).map((f) => f.path)
    )

    // 收集候选条目：路径归一化 + 去重 + 过滤
    const candidates: { path: string; content: string }[] = []
    const seen = new Set<string>()
    let skippedBinary = 0
    let skippedConflict = 0
    let skippedOversize = 0

    const entries = Object.values(zip.files)
    for (const entry of entries) {
      if (entry.dir) continue
      const normalized = entry.name.replace(/\\/g, '/').replace(/^\/+/, '')
      if (!normalized || normalized.includes('..')) continue
      if (SKIP_DIR_PREFIXES.some((p) => normalized.startsWith(p))) continue
      const base = normalized.split('/').pop() ?? ''
      if (SKIP_FILE_NAMES.includes(base)) continue
      // 同一 ZIP 内重复路径只取第一个
      if (seen.has(normalized)) {
        skippedConflict++
        continue
      }
      seen.add(normalized)

      const data = await entry.async('uint8array')
      if (data.byteLength > MAX_ENTRY_BYTES) {
        skippedOversize++
        continue
      }
      // 二进制检测：UTF-8 解码含 NUL 字节即视为二进制
      const text = Buffer.from(data).toString('utf8')
      if (text.includes('\u0000')) {
        skippedBinary++
        continue
      }
      if (existing.has(normalized)) {
        skippedConflict++
        continue
      }
      candidates.push({ path: normalized, content: text })
      if (candidates.length >= MAX_CREATED) break
    }

    if (candidates.length === 0) {
      return NextResponse.json(
        {
          error: '没有可导入的文本文件（可能全部为二进制 / 已存在 / 超过大小限制）',
          skippedBinary,
          skippedConflict,
          skippedOversize,
        },
        { status: 400 }
      )
    }

    const created = await db.$transaction(
      candidates.map((c) =>
        db.projectFile.create({
          data: { path: c.path, content: c.content, language: inferLanguage(c.path) },
        })
      )
    )

    return NextResponse.json({
      created: created.length,
      createdPaths: created.map((f) => f.path).slice(0, 20),
      skippedBinary,
      skippedConflict,
      skippedOversize,
    })
  } catch (error) {
    console.error('POST /api/files/import-zip failed:', error)
    return NextResponse.json({ error: '导入 ZIP 失败' }, { status: 500 })
  }
}
