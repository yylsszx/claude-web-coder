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

type StreamFrame =
  | { t: 'delta'; v: string }
  | { t: 'done'; userMessageId: string; assistantMessageId: string; sessionId: string; sessionTitle: string }
  | { t: 'error'; v: string }

function sse(frame: StreamFrame): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`)
}

/** POST /api/chat/stream —— 流式对话：上游 SSE 解析为增量帧，结束后持久化 */
export async function POST(request: NextRequest) {
  let message = ''
  let requestedSessionId: string | null = null
  let userContent = ''
  try {
    const body = await request.json()
    message = typeof body.message === 'string' ? body.message.trim() : ''
    requestedSessionId = typeof body.sessionId === 'string' ? body.sessionId : null
    if (!message) {
      return Response.json({ error: '消息不能为空' }, { status: 400 })
    }

    // 拼接当前文件上下文
    userContent = message
    if (
      body.currentFile &&
      typeof body.currentFile.path === 'string' &&
      typeof body.currentFile.content === 'string'
    ) {
      const { path, content, language } = body.currentFile
      userContent +=
        `\n\n---\n[当前打开的文件] ${path}（${language ?? 'plaintext'}）：\n` +
        '```' + (language ?? '') + '\n' + content + '\n```'
    }
  } catch {
    return Response.json({ error: '请求体解析失败' }, { status: 400 })
  }

  // 会话解析：无效/未传时回退默认会话；历史与用户消息落库
  const sessionId = await resolveSessionId(requestedSessionId)
  const history = await db.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
  })
  const historyMessages = history
    .reverse()
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  const savedUserMessage = await db.chatMessage.create({
    data: { sessionId, role: 'user', content: message },
  })

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
    await db.chatMessage.delete({ where: { id: savedUserMessage.id } }).catch(() => {})
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
