import { NextRequest } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { deriveTitle, resolveSessionId } from '@/lib/session'

export const runtime = 'nodejs'
export const maxDuration = 300

const SYSTEM_PROMPT = `你是一个网页版 AI 编程工作台内置的编程助手，风格参考 Claude 与 Cline：
- 始终使用中文回答，语气友好、专业、简洁。
- 涉及代码时，必须把代码放在 Markdown 围栏代码块中，并标注语言（如 \`\`\`ts、\`\`\`python）。
- 如果用户要求"写/生成/修改/修复"代码，请给出**完整的最终代码**（而不是零散片段），方便用户一键应用到文件。
- 需要修改已有文件时，输出修改后的完整文件内容，并用一句话说明改动点。
- 回答控制在合理篇幅：先给结论或代码，再给必要的简短解释。`

const HISTORY_LIMIT = 10
/** @ 引用的文件：最多 5 个，单个内容截断长度 */
const MAX_REFERENCED_FILES = 5
const MAX_REF_CONTENT_CHARS = 50000

interface ReferencedFile {
  path: string
  content: string
  language?: string
}

/** 从请求体提取合法的 @ 引用文件列表（容错：非法项直接丢弃） */
function parseReferencedFiles(raw: unknown): ReferencedFile[] {
  if (!Array.isArray(raw)) return []
  const files: ReferencedFile[] = []
  for (const item of raw) {
    if (
      item &&
      typeof item.path === 'string' &&
      typeof item.content === 'string' &&
      files.length < MAX_REFERENCED_FILES
    ) {
      files.push({
        path: item.path,
        content: item.content.slice(0, MAX_REF_CONTENT_CHARS),
        language: typeof item.language === 'string' ? item.language : undefined,
      })
    }
  }
  return files
}

type StreamFrame =
  | { t: 'delta'; v: string }
  | { t: 'done'; userMessageId: string; assistantMessageId: string; sessionId: string; sessionTitle: string }
  | { t: 'error'; v: string }

function sse(frame: StreamFrame): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`)
}

/** POST /api/chat/stream —— 流式对话：上游 SSE 解析为增量帧，结束后持久化
 * regenerate=true 时复用会话中最后一条用户消息并删除其后的旧 AI 回复（重新生成）
 * editMessageId 传入时：更新该用户消息内容并删除其后所有消息，重新生成（编辑重发）
 */
export async function POST(request: NextRequest) {
  let message = ''
  let requestedSessionId: string | null = null
  let currentFile: { path: string; content: string; language?: string } | null = null
  let referencedFiles: ReferencedFile[] = []
  let regenerate = false
  let editMessageId: string | null = null
  try {
    const body = await request.json()
    message = typeof body.message === 'string' ? body.message.trim() : ''
    requestedSessionId = typeof body.sessionId === 'string' ? body.sessionId : null
    regenerate = body.regenerate === true
    editMessageId = typeof body.editMessageId === 'string' && body.editMessageId ? body.editMessageId : null
    if (!message) {
      return Response.json({ error: '消息不能为空' }, { status: 400 })
    }
    if (
      body.currentFile &&
      typeof body.currentFile.path === 'string' &&
      typeof body.currentFile.content === 'string'
    ) {
      currentFile = {
        path: body.currentFile.path,
        content: body.currentFile.content,
        language: typeof body.currentFile.language === 'string' ? body.currentFile.language : undefined,
      }
    }
    referencedFiles = parseReferencedFiles(body.referencedFiles)
  } catch {
    return Response.json({ error: '请求体解析失败' }, { status: 400 })
  }

  // 会话解析：无效/未传时回退默认会话
  const sessionId = await resolveSessionId(requestedSessionId)

  // 确定本次对话对应的用户消息：新建 / 复用最后一条（重新生成）/ 编辑指定消息（编辑重发）
  let savedUserMessage: { id: string; content: string; createdAt: Date }
  if (editMessageId) {
    const target = await db.chatMessage.findUnique({ where: { id: editMessageId } })
    if (!target || target.sessionId !== sessionId || target.role !== 'user') {
      return Response.json({ error: '找不到可编辑的用户消息' }, { status: 400 })
    }
    // 更新消息内容，并删除其后所有消息（含旧回复），随后重新流式生成
    await db.chatMessage.deleteMany({
      where: { sessionId, createdAt: { gt: target.createdAt } },
    })
    savedUserMessage = await db.chatMessage.update({
      where: { id: target.id },
      data: { content: message },
    })
  } else if (regenerate) {
    const lastUser = await db.chatMessage.findFirst({
      where: { sessionId, role: 'user' },
      orderBy: { createdAt: 'desc' },
    })
    if (!lastUser) {
      return Response.json({ error: '没有可重新生成的用户消息' }, { status: 400 })
    }
    // 删除该用户消息之后的所有旧 AI 回复，等待重新生成
    await db.chatMessage.deleteMany({
      where: { sessionId, role: 'assistant', createdAt: { gte: lastUser.createdAt } },
    })
    savedUserMessage = lastUser
    message = lastUser.content
  } else {
    savedUserMessage = await db.chatMessage.create({
      data: { sessionId, role: 'user', content: message },
    })
  }

  // 历史：取该用户消息之前的最近 N 条（重新生成时自动排除已删除的旧回复）
  const history = await db.chatMessage.findMany({
    where: { sessionId, createdAt: { lt: savedUserMessage.createdAt } },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
  })
  const historyMessages = history
    .reverse()
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  // 拼接当前文件与 @ 引用文件上下文
  let userContent = message
  if (currentFile) {
    const { path, content, language } = currentFile
    userContent +=
      `\n\n---\n[当前打开的文件] ${path}（${language ?? 'plaintext'}）：\n` +
      '```' + (language ?? '') + '\n' + content + '\n```'
  }
  for (const file of referencedFiles) {
    userContent +=
      `\n\n---\n[用户 @ 引用的文件] ${file.path}（${file.language ?? 'plaintext'}）：\n` +
      '```' + (file.language ?? '') + '\n' + file.content + '\n```'
  }

  let zai: Awaited<ReturnType<typeof ZAI.create>>
  let upstream: ReadableStream<Uint8Array>
  try {
    zai = await ZAI.create()
    const result = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: SYSTEM_PROMPT },
        ...historyMessages,
        { role: 'user', content: userContent },
      ],
      stream: true,
      thinking: { type: 'disabled' },
    })
    if (!(result instanceof ReadableStream)) {
      throw new Error('上游未返回流式响应')
    }
    upstream = result
  } catch (error) {
    console.error('POST /api/chat/stream upstream failed:', error)
    // 上游失败：普通发送时回滚用户消息；重新生成/编辑重发时保留原用户消息（可直接重试）
    if (!regenerate && !editMessageId) {
      await db.chatMessage.delete({ where: { id: savedUserMessage.id } }).catch(() => {})
    }
    const detail = error instanceof Error ? error.message : '未知错误'
    return Response.json({ error: `AI 调用失败：${detail}` }, { status: 500 })
  }

  const touchSession = async () => {
    try {
      const session = await db.chatSession.findUnique({ where: { id: sessionId } })
      if (!session) return
      const data: { updatedAt?: Date; title?: string } = { updatedAt: new Date() }
      if (session.title === '新会话') data.title = deriveTitle(message)
      const updated = await db.chatSession.update({ where: { id: sessionId }, data })
      sessionTitle = updated.title
    } catch (error) {
      console.error('touchSession failed:', error)
    }
  }
  let sessionTitle = ''

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const decoder = new TextDecoder()
      const reader = upstream.getReader()
      let buffer = ''
      let full = ''
      let persistedId: string | null = null
      let clientGone = request.signal.aborted

      // 客户端断开（如点击「停止生成」）→ 取消上游读取，已生成部分照常落库
      const onAbort = () => {
        clientGone = true
        reader.cancel().catch(() => {})
      }
      request.signal.addEventListener('abort', onAbort, { once: true })

      // 客户端已断开时 enqueue 会抛错，吞掉即可（落库逻辑照常执行）
      const safeEnqueue = (frame: Uint8Array) => {
        try {
          controller.enqueue(frame)
        } catch {
          // 连接已断开
        }
      }

      // 只落库一次：无论正常结束、出错还是客户端断连
      const persistPartial = async (): Promise<string | null> => {
        if (persistedId || !full.trim()) return null
        try {
          const saved = await db.chatMessage.create({
            data: { sessionId, role: 'assistant', content: full },
          })
          persistedId = saved.id
          await touchSession()
          return saved.id
        } catch (error) {
          console.error('persist assistant message failed:', error)
          return null
        }
      }

      const flushLine = (line: string) => {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) return
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') return
        try {
          const json = JSON.parse(payload)
          const delta: string | undefined =
            json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content
          if (delta) {
            full += delta
            safeEnqueue(sse({ t: 'delta', v: delta }))
          }
        } catch {
          // 忽略无法解析的行（如心跳注释）
        }
      }

      try {
        while (!clientGone) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) flushLine(line)
        }
        if (buffer && !clientGone) flushLine(buffer)

        if (full.trim()) {
          // 正常完成或中途停止：持久化完整/部分内容
          const savedId = await persistPartial()
          if (savedId) {
            safeEnqueue(
              sse({
                t: 'done',
                userMessageId: savedUserMessage.id,
                assistantMessageId: savedId,
                sessionId,
                sessionTitle,
              })
            )
          } else {
            safeEnqueue(sse({ t: 'error', v: 'AI 结果保存失败' }))
          }
        } else {
          safeEnqueue(
            sse({ t: 'error', v: clientGone ? '已停止生成' : 'AI 返回了空内容' })
          )
        }
      } catch (error) {
        console.error('stream processing failed:', error)
        const savedId = await persistPartial()
        if (savedId) {
          safeEnqueue(
            sse({
              t: 'done',
              userMessageId: savedUserMessage.id,
              assistantMessageId: savedId,
              sessionId,
              sessionTitle,
            })
          )
        } else {
          safeEnqueue(
            sse({ t: 'error', v: error instanceof Error ? error.message : '流式传输失败' })
          )
        }
      } finally {
        request.signal.removeEventListener('abort', onAbort)
        try {
          controller.close()
        } catch {
          // 连接已断开
        }
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
