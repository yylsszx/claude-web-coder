import { NextRequest } from 'next/server'
import JSZip from 'jszip'
import { db } from '@/lib/db'
import { parseSessionImportBody, MAX_MESSAGES_PER_SESSION } from '@/lib/session-import'

export const runtime = 'nodejs'

/** 上传 ZIP 大小上限 */
const MAX_ZIP_BYTES = 20 * 1024 * 1024
/** ZIP 批量恢复：单个会话 JSON 大小上限（带图片附件的会话较大，取 8MB） */
const MAX_ENTRY_BYTES = 8 * 1024 * 1024
/** 单次最多导入会话数 */
const MAX_SESSIONS = 100

/**
 * POST /api/sessions/import-batch —— 批量导入会话备份 ZIP（与 /api/sessions/export 闭环）。
 * multipart/form-data，字段名 file。规则：
 * - 解包 zip 内全部 .json（跳过 manifest.json 与非 json 文件）
 * - 每个文件走与单会话导入完全一致的校验（共享 session-import lib）
 * - 无效 / 无消息的文件逐个跳过并在结果中报告原因，不中断整体导入
 * - 最多 100 个会话；导入的会话 createdAt 还原（备份里的首条消息时间），标题沿用
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return Response.json({ error: '缺少 file 字段' }, { status: 400 })
    }
    if (file.size > MAX_ZIP_BYTES) {
      return Response.json(
        { error: `ZIP 文件过大（上限 ${(MAX_ZIP_BYTES / 1024 / 1024).toFixed(0)}MB）` },
        { status: 400 }
      )
    }

    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()))
    } catch {
      return Response.json({ error: '无法解析 ZIP 文件（已损坏或非 ZIP 格式）' }, { status: 400 })
    }

    const results: { file: string; title?: string; messages?: number; error?: string }[] = []
    let imported = 0

    const entries = Object.values(zip.files).filter((e) => !e.dir)
    for (const entry of entries) {
      if (imported >= MAX_SESSIONS) {
        results.push({ file: entry.name, error: '会话数超出单次上限（100），未导入' })
        continue
      }
      if (!entry.name.toLowerCase().endsWith('.json')) {
        results.push({ file: entry.name, error: '非 JSON 文件，跳过' })
        continue
      }
      if (entry.name.toLowerCase().endsWith('manifest.json')) continue // 清单不导入

      const raw = await entry.async('uint8array')
      if (raw.byteLength > MAX_ENTRY_BYTES) {
        results.push({ file: entry.name, error: '文件超过 2MB，跳过' })
        continue
      }
      let body: unknown
      try {
        body = JSON.parse(Buffer.from(raw).toString('utf8'))
      } catch {
        results.push({ file: entry.name, error: 'JSON 解析失败，跳过' })
        continue
      }
      // 兼容 manifest 误导入：kind 标记的清单文件跳过
      if (
        body &&
        typeof body === 'object' &&
        (body as { kind?: unknown }).kind === 'sessions-backup'
      ) {
        continue
      }
      const parsed = parseSessionImportBody(
        body as { title?: unknown; messages?: unknown }
      )
      if (!parsed.ok) {
        results.push({ file: entry.name, error: parsed.error })
        continue
      }
      // 会话标题优先用备份内标注的；无 title 字段时用解析出的默认
      const data = body as { session?: { title?: unknown } }
      const title =
        typeof data.session?.title === 'string' && data.session.title.trim()
          ? data.session.title.trim().slice(0, 60)
          : parsed.title
      // createdAt 还原：取首条消息时间（无则库默认 now）
      const firstAt = parsed.messages[0]?.createdAt

      const session = await db.$transaction(async (tx) => {
        const s = await tx.chatSession.create({
          data: { title, ...(firstAt ? { createdAt: firstAt, updatedAt: firstAt } : {}) },
        })
        await tx.chatMessage.createMany({
          data: parsed.messages.map((m) => ({
            sessionId: s.id,
            role: m.role,
            content: m.content,
            ...(m.createdAt ? { createdAt: m.createdAt } : {}),
            ...(m.attachments?.length
              ? { attachments: JSON.stringify(m.attachments) }
              : {}),
          })),
        })
        return s
      })
      imported++
      results.push({
        file: entry.name,
        title: session.title,
        messages: parsed.messages.length,
      })
    }

    if (imported === 0) {
      return Response.json(
        {
          error: 'ZIP 中没有可导入的会话',
          results,
        },
        { status: 400 }
      )
    }

    return Response.json({
      imported,
      maxMessagesPerSession: MAX_MESSAGES_PER_SESSION,
      results,
    })
  } catch (error) {
    console.error('POST /api/sessions/import-batch failed:', error)
    return Response.json({ error: '批量导入会话失败' }, { status: 500 })
  }
}
