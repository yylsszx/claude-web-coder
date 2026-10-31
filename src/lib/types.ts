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
}

export interface SessionMeta {
  id: string
  title: string
  /** 是否置顶（置顶会话在会话列表优先展示） */
  pinned?: boolean
  messageCount: number
  updatedAt: string
}
