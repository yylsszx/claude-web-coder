import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

const MAX_MATCHES_PER_FILE = 20
const MAX_RESULTS = 30
const SNIPPET_MAX_LEN = 160

interface SearchMatch {
  line: number
  text: string
}

interface SearchResultItem {
  id: string
  path: string
  language: string
  /** 内容命中行（最多 20 条） */
  matches: SearchMatch[]
  /** 内容命中总数（可能超过 matches 长度） */
  matchCount: number
  /** 是否命中文件名 */
  pathMatch: boolean
}

/** GET /api/search?q=xxx —— 跨文件全局搜索（文件名 + 内容，大小写不敏感） */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
  if (!q) {
    return Response.json({ results: [] })
  }

  const files = await db.projectFile.findMany({
    select: { id: true, path: true, content: true, language: true },
  })

  const lowerQ = q.toLowerCase()
  const results: SearchResultItem[] = []

  for (const file of files) {
    const pathMatch = file.path.toLowerCase().includes(lowerQ)
    const matches: SearchMatch[] = []
    let matchCount = 0

    const lines = file.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(lowerQ)) {
        matchCount++
        if (matches.length < MAX_MATCHES_PER_FILE) {
          matches.push({
            line: i + 1,
            text: lines[i].trim().slice(0, SNIPPET_MAX_LEN),
          })
        }
      }
    }

    if (pathMatch || matches.length > 0) {
      results.push({
        id: file.id,
        path: file.path,
        language: file.language,
        matches,
        matchCount,
        pathMatch,
      })
    }
    if (results.length >= MAX_RESULTS) break
  }

  // 内容命中优先于仅文件名命中，再按命中数排序
  results.sort((a, b) => {
    if (a.matches.length > 0 !== b.matches.length > 0) {
      return a.matches.length > 0 ? -1 : 1
    }
    return b.matchCount - a.matchCount
  })

  return Response.json({ results })
}
