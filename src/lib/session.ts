import { db } from '@/lib/db'

/** 默认会话固定 ID（历史消息迁移目标） */
export const DEFAULT_SESSION_ID = 'cdefaultsession0000000000'

/** 获取默认会话；不存在则创建 */
export async function getOrCreateDefaultSession() {
  const existing = await db.chatSession.findUnique({ where: { id: DEFAULT_SESSION_ID } })
  if (existing) return existing
  return db.chatSession.create({
    data: { id: DEFAULT_SESSION_ID, title: '默认会话' },
  })
}

/**
 * 解析请求指向的会话：优先使用传入的 sessionId，
 * 会话不存在（或未传）时回退到默认会话。
 */
export async function resolveSessionId(requested?: string | null): Promise<string> {
  if (requested) {
    const session = await db.chatSession.findUnique({ where: { id: requested } })
    if (session) return session.id
  }
  const fallback = await getOrCreateDefaultSession()
  return fallback.id
}

/** 由首条用户消息生成会话标题 */
export function deriveTitle(text: string, max = 24): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return '新会话'
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}
