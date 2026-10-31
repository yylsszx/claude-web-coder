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
  messageCount: number
  updatedAt: string
}
