import JSZip from 'jszip'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/** 单会话 JSON 大小上限（超出跳过，防超大文件撑爆 zip） */
const MAX_SESSION_BYTES = 2 * 1024 * 1024
/** 会话数上限 */
const MAX_SESSIONS = 200

/** 会话标题 → 安全文件名 */
function safeName(title: string, id: string): string {
  const base =
    title
      .replace(/[/\\:*?"<>|\s]+/g, '-')
      .slice(0, 40)
      .replace(/^-+|-+$/g, '') || 'chat'
  // 尾部短 id 保证重名会话文件不冲突
  return `${base}-${id.slice(-6)}.json`
}

/**
 * GET /api/sessions/export —— 全部会话打包 ZIP 下载（与 import-batch 闭环）。
 * 每个会话一个 JSON 文件，schema 与单会话导出完全一致
 * （app / schemaVersion / exportedAt / session / messages），
 * 因此 zip 里的单个文件也能直接用既有的单会话「导入」按钮恢复。
 * manifest.json 汇总清单（kind: sessions-backup）。
 */
export async function GET() {
  try {
    const sessions = await db.chatSession.findMany({
      orderBy: { createdAt: 'asc' },
      take: MAX_SESSIONS,
    })

    const zip = new JSZip()
    const manifest: {
      app: string
      schemaVersion: number
      kind: string
      exportedAt: string
      count: number
      files: { file: string; title: string; messages: number }[]
    } = {
      app: 'claude-web-coder',
      schemaVersion: 1,
      kind: 'sessions-backup',
      exportedAt: new Date().toISOString(),
      count: 0,
      files: [],
    }

    for (const session of sessions) {
      const messages = await db.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'asc' },
      })
      const payload = {
        app: 'claude-web-coder',
        schemaVersion: 1,
        exportedAt: manifest.exportedAt,
        session: { title: session.title, messageCount: messages.length },
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
        })),
      }
      const json = JSON.stringify(payload, null, 2)
      if (Buffer.byteLength(json, 'utf8') > MAX_SESSION_BYTES) continue
      const file = safeName(session.title, session.id)
      zip.file(file, json)
      manifest.count++
      manifest.files.push({
        file,
        title: session.title,
        messages: messages.length,
      })
    }
    zip.file('manifest.json', JSON.stringify(manifest, null, 2))

    const buf = await zip.generateAsync({ type: 'uint8array' })
    const stamp = manifest.exportedAt.slice(0, 10)
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="sessions-backup-${stamp}.zip"`,
      },
    })
  } catch (error) {
    console.error('GET /api/sessions/export failed:', error)
    return Response.json({ error: '导出会话备份失败' }, { status: 500 })
  }
}
