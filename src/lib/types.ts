export interface FileMeta {
  id: string
  path: string
  language: string
  createdAt: string
  updatedAt: string
}

export interface FileFull extends FileMeta {
  content: string
}

export interface ChatMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  /** 图片附件（data URL 数组，仅用户消息） */
  attachments?: string[]
  /** 流式生成耗时（毫秒）：仅本次会话由前端记录，历史消息 / 刷新后无此字段 */
  durationMs?: number
  /** 是否被用户手动中断生成（部分内容保留）：仅本次会话由前端标记，刷新后无此字段 */
  interrupted?: boolean
}

export interface SessionMeta {
  id: string
  title: string
  /** 是否置顶（置顶会话在会话列表优先展示） */
  pinned?: boolean
  messageCount: number
  updatedAt: string
  /** 最后一条消息的内容（供会话下拉展示摘要，API 已剥到前端自行截取首行） */
  lastMessage?: string
}
