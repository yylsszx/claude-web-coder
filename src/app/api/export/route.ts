import JSZip from 'jszip'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/** GET /api/export —— 把工作区全部文件打包为 ZIP 下载 */
export async function GET() {
  const files = await db.projectFile.findMany({ orderBy: { path: 'asc' } })

  const zip = new JSZip()
  for (const file of files) {
    zip.file(file.path, file.content)
  }
  const buf = await zip.generateAsync({ type: 'uint8array' })

  const stamp = new Date().toISOString().slice(0, 10)
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="workspace-${stamp}.zip"`,
      'Cache-Control': 'no-store',
    },
  })
}
