import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { ensureSeed } from '@/lib/seed'
import { deriveTitle, resolveSessionId } from '@/lib/session'

const SYSTEM_PROMPT = `你是一个网页版 AI 编程工作台内置的编程助手，风格参考 Claude 与 Cline：
- 始终使用中文回答，语气友好、专业、简洁。
- 涉及代码时，必须把代码放在 Markdown 围栏代码块中，并标注语言（如 \`\`\`ts、\`\`\`python）。
- 如果用户要求"写/生成/修改/修复"代码，请给出**完整的最终代码**（而不是零散片段），方便用户一键应用到文件。
- 需要修改已有文件时，输出修改后的完整文件内容，并用一句话说明改动点。
- 回答控制在合理篇幅：先给结论或代码，再给必要的简短解释。`

const HISTORY_LIMIT = 10

const WELCOME_MESSAGE = `你好！我是你的 AI 编程助手 👋 我可以帮你生成、解释、优化代码。`

/** GET /api/chat?sessionId= —— 读取指定会话的聊天记录 */
export async function GET(request: NextRequest) {
  try {
    await ensureSeed()
    const sessionId = await resolveSessionId(request.nextUrl.searchParams.get('sessionId'))
    const messages = await db.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
    return NextResponse.json({ messages, sessionId })
  } catch (error) {
    console.error('GET /api/chat failed:', error)
    return NextResponse.json({ error: '获取聊天记录失败' }, { status: 500 })
  }
}

/** POST /api/chat —— 非流式对话（保留兼容，前端主用 /api/chat/stream） */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message) {
      return NextResponse.json({ error: '消息不能为空' }, { status: 400 })
    }
    const sessionId = await resolveSessionId(body.sessionId)

    // 拼接当前文件上下文
    let userContent = message
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

    // 加载历史（不含本次输入）
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

    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: SYSTEM_PROMPT },
        ...historyMessages,
        { role: 'user', content: userContent },
      ],
      thinking: { type: 'disabled' },
    })

    const reply = completion.choices[0]?.message?.content
    if (!reply || !reply.trim()) {
      throw new Error('AI 返回了空内容')
    }

    const savedAssistantMessage = await db.chatMessage.create({
      data: { sessionId, role: 'assistant', content: reply },
    })
    await touchSession(sessionId, message)

    return NextResponse.json({
      userMessage: savedUserMessage,
      assistantMessage: savedAssistantMessage,
    })
  } catch (error) {
    console.error('POST /api/chat failed:', error)
    const detail = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json({ error: `AI 调用失败：${detail}` }, { status: 500 })
  }
}

/** DELETE /api/chat?sessionId= —— 清空指定会话的聊天记录（保留会话，重置欢迎语） */
export async function DELETE(request: NextRequest) {
  try {
    const sessionId = await resolveSessionId(request.nextUrl.searchParams.get('sessionId'))
    await db.chatMessage.deleteMany({ where: { sessionId } })
    await db.chatMessage.create({
      data: { sessionId, role: 'assistant', content: WELCOME_MESSAGE },
    })
    const messages = await db.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ messages, sessionId })
  } catch (error) {
    console.error('DELETE /api/chat failed:', error)
    return NextResponse.json({ error: '清空聊天记录失败' }, { status: 500 })
  }
}

/** 会话有首条用户消息且标题仍为默认时自动命名，并刷新 updatedAt */
async function touchSession(sessionId: string, firstUserMessage: string) {
  try {
    const session = await db.chatSession.findUnique({ where: { id: sessionId } })
    if (!session) return
    const data: { updatedAt?: Date; title?: string } = { updatedAt: new Date() }
    if (session.title === '新会话') {
      data.title = deriveTitle(firstUserMessage)
    }
    await db.chatSession.update({ where: { id: sessionId }, data })
  } catch (error) {
    console.error('touchSession failed:', error)
  }
}
