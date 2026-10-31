import { useSyncExternalStore } from 'react'

const emptySubscribe = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

/**
 * 客户端挂载检测（hydration 安全）：SSR 返回 false，客户端 hydration 完成后为 true。
 * 用于「依赖客户端时钟 / localStorage / 主题」的内容延迟渲染，避免 hydration mismatch。
 */
export function useMounted() {
  return useSyncExternalStore(emptySubscribe, getClientSnapshot, getServerSnapshot)
}
