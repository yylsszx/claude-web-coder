'use client'

/** 代码块收藏：localStorage 持久化（仅本浏览器），模块级缓存 + 事件广播。
 * ChatPanel 经 useSyncExternalStore 订阅（SSR 快照空数组，无 hydration 顾虑），
 * 收藏夹对话框与代码块按钮的星星态保持同步 */

export interface CodeFavorite {
  id: string
  /** 语言标注（如 ts / python，可能为空串） */
  lang: string
  code: string
  createdAt: string
}

const KEY = 'cw-code-favorites'
const EVENT = 'cw-code-favorites-changed'
/** 收藏上限：超出时淘汰最早的（代码片段体积可控，50 条足够回溯） */
export const MAX_FAVORITES = 50

let cache: CodeFavorite[] | null = null

/** 读取收藏列表（损坏数据容错为空数组） */
export function readCodeFavorites(): CodeFavorite[] {
  if (cache) return cache
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    cache = Array.isArray(parsed)
      ? parsed.filter(
          (f): f is CodeFavorite =>
            f && typeof f.id === 'string' && typeof f.code === 'string' && typeof f.lang === 'string'
        )
      : []
  } catch {
    cache = []
  }
  return cache
}

/** 写入收藏列表（裁剪到上限、广播事件） */
export function writeCodeFavorites(list: CodeFavorite[]): void {
  cache = list.slice(0, MAX_FAVORITES)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* 存储不可用时仅本次会话内存生效 */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export function subscribeCodeFavorites(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, cb)
  return () => window.removeEventListener(EVENT, cb)
}

/** 收藏去重键：语言 + 完整代码（同一代码块重复点击 = 取消收藏） */
export function favoriteKey(lang: string, code: string): string {
  return `${lang}\u0000${code}`
}

/** 切换收藏：已收藏则移除并返回 false（取消），否则新增置顶并返回 true；超出上限自动淘汰最早一条 */
export function toggleCodeFavorite(lang: string, code: string): boolean {
  const key = favoriteKey(lang, code)
  const list = readCodeFavorites()
  if (list.some((f) => favoriteKey(f.lang, f.code) === key)) {
    writeCodeFavorites(list.filter((f) => favoriteKey(f.lang, f.code) !== key))
    return false
  }
  const item: CodeFavorite = {
    id: `fav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lang,
    code,
    createdAt: new Date().toISOString(),
  }
  writeCodeFavorites([item, ...list])
  return true
}

/** 移除指定收藏 */
export function removeCodeFavorite(id: string): void {
  writeCodeFavorites(readCodeFavorites().filter((f) => f.id !== id))
}
