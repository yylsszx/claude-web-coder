import { NextRequest } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'

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
  | { t: 'done'; userMessageId: string; assistantMessageId: string }
  | { t: 'error'; v: string }

function sse(frame: StreamFrame): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`)
}

/** POST /api/chat/stream —— 流式对话：上游 SSE 解析为增量帧，结束后持久化 */
export async function POST(request: NextRequest) {
  let message = ''
  let userContent = ''
  try {
    const body = await request.json()
    message = typeof body.message === 'string' ? body.message.trim() : ''
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

  // 历史与用户消息落库
  const history = await db.chatMessage.findMany({
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
  })
  const historyMessages = history
    .reverse()
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  const savedUserMessage = await db.chatMessage.create({
    data: { role: 'user', content: message },
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

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const decoder = new TextDecoder()
      const reader = upstream.getReader()
      let buffer = ''
      let full = ''

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
            controller.enqueue(sse({ t: 'delta', v: delta }))
          }
        } catch {
          // 忽略无法解析的行（如心跳注释）
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) flushLine(line)
        }
        if (buffer) flushLine(buffer)

        if (!full.trim()) {
          throw new Error('AI 返回了空内容')
        }

        const savedAssistantMessage = await db.chatMessage.create({
          data: { role: 'assistant', content: full },
        })
        controller.enqueue(
          sse({
            t: 'done',
            userMessageId: savedUserMessage.id,
            assistantMessageId: savedAssistantMessage.id,
          })
        )
      } catch (error) {
        console.error('stream processing failed:', error)
        // 有部分内容时仍持久化，避免丢失
        if (full.trim()) {
          const partial = await db.chatMessage.create({
            data: { role: 'assistant', content: full },
          })
          controller.enqueue(
            sse({
              t: 'done',
              userMessageId: savedUserMessage.id,
              assistantMessageId: partial.id,
            })
          )
        } else {
          controller.enqueue(
            sse({ t: 'error', v: error instanceof Error ? error.message : '流式传输失败' })
          )
        }
      } finally {
        controller.close()
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
