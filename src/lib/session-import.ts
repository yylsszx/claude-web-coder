/**
 * 会话导入的共享校验 / 过滤逻辑。
 * 单会话导入（POST /api/sessions 导入模式）与批量导入（import-batch 端点）共用，
 * 保证「角色白名单 / 非空内容 / 条数上限 / createdAt 还原」规则一致。
 */

export interface ParsedImportMessage {
  role: 'user' | 'assistant'
  content: string
  createdAt?: Date
}

export type SessionImportResult =
  | { ok: true; title: string; messages: ParsedImportMessage[] }
  | { ok: false; error: string; status: number }

/** 单会话消息数上限 */
export const MAX_MESSAGES_PER_SESSION = 500

/** 解析 / 校验单会话导入 body（{title?, messages?}），返回规范化的会话数据或错误。
    title 取值链：顶层 title → session.title（备份文件 schema 直传时），都没有用默认。 */
export function parseSessionImportBody(body: {
  title?: unknown
  messages?: unknown
  session?: { title?: unknown } | null
}): SessionImportResult {
  const rawMessages = Array.isArray(body.messages) ? body.messages : []
  if (rawMessages.length === 0) {
    return { ok: false, error: '没有可导入的消息', status: 400 }
  }
  if (rawMessages.length > MAX_MESSAGES_PER_SESSION) {
    return {
      ok: false,
      error: `消息数超出上限（最多 ${MAX_MESSAGES_PER_SESSION} 条）`,
      status: 400,
    }
  }

  const rawTitle =
    typeof body.title === 'string' && body.title.trim()
      ? body.title
      : typeof body.session?.title === 'string' && body.session.title.trim()
        ? body.session.title
        : ''
  const title = rawTitle.trim() ? rawTitle.trim().slice(0, 60) : '导入的会话'

  // 记录每条原始消息的 createdAt（对象引用为键），过滤后仍能对应还原时间
  const rawCreatedAts = new Map<object, string | number | Date>()
  for (const m of rawMessages) {
    if (m && typeof m === 'object') {
      const c = (m as { createdAt?: unknown }).createdAt
      if (typeof c === 'string' || typeof c === 'number' || c instanceof Date) {
        rawCreatedAts.set(m, c)
      }
    }
  }

  const messages = rawMessages
    .filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        !!m &&
        typeof m === 'object' &&
        ((m as { role?: unknown }).role === 'user' ||
          (m as { role?: unknown }).role === 'assistant') &&
        typeof (m as { content?: unknown }).content === 'string' &&
        (m as { content: string }).content.trim().length > 0
    )
    .map((m) => {
      // 尽量还原原始时间（可解析时），否则省略 createdAt（数据库 now 默认）
      const raw = rawCreatedAts.get(m)
      const t = raw !== undefined ? new Date(raw) : null
      return {
        role: m.role,
        content: m.content,
        ...(t && !Number.isNaN(t.getTime()) ? { createdAt: t } : {}),
      }
    })

  if (messages.length === 0) {
    return { ok: false, error: '没有有效的消息（需含 role 与非空 content）', status: 400 }
  }

  return { ok: true, title, messages }
}
