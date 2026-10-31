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
  /** 流式生成耗时（毫秒）：仅本次会话由前端记录，历史消息 / 刷新后无此字段 */
  durationMs?: number
}

export interface SessionMeta {
  id: string
  title: string
  /** 是否置顶（置顶会话在会话列表优先展示） */
  pinned?: boolean
  messageCount: number
  updatedAt: string
}
