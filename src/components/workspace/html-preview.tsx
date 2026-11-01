'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eye, Loader2, RotateCw, ExternalLink } from 'lucide-react'

/**
 * HTML 实时预览面板：
 * - 编辑区内容防抖 600ms 后编译进 iframe（srcdoc），沙箱隔离（不给 allow-same-origin，
 *   预览页脚本无法访问主应用的 cookie / localStorage / DOM）
 * - 本地 CSS / JS 引用自动内联：多文件项目（index.html + style.css + app.js）也能完整预览——
 *   已打开标签取实时内容（含未保存修改），未打开文件经页面层按需拉取
 * - 工具条：自动刷新开关（记忆）/ 手动刷新（强制重编译重载）/ 在新标签打开编译后的页面
 */

interface HtmlPreviewFrameProps {
  /** 当前 HTML 文件路径（解析相对引用的基准目录） */
  path: string
  /** 编辑器实时内容 */
  content: string
  /** 已打开标签的实时内容（路径 → 内容，含未保存修改） */
  openFiles: Record<string, string>
  /** 按需拉取未打开文件内容（页面层实现；null 表示工作区不存在该路径） */
  resolveFile: (path: string) => Promise<string | null>
}

/** 外部绝对地址 / data: / 锚点等非本地引用一律原样保留（交给浏览器加载） */
const NON_LOCAL_RE = /^(https?:)?\/\/|^data:|^blob:|^mailto:|^javascript:|^#/i

/** 工作区路径规范化：去前导斜杠、合并连续斜杠（工作区文件路径不含前导 /） */
const normalizeWsPath = (p: string) => p.replace(/^\/+/, '').replace(/\/+/g, '/')

/** 相对引用 → 工作区路径（baseDir 为当前 HTML 所在目录，不含前导 /，可为空串） */
function resolveWsRef(baseDir: string, ref: string): string {
  const parts = baseDir ? baseDir.split('/') : []
  for (const seg of ref.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

const AUTO_KEY = 'cw-html-preview-auto'

export function HtmlPreviewFrame({ path, content, openFiles, resolveFile }: HtmlPreviewFrameProps) {
  const [compiled, setCompiled] = useState('')
  const [compiling, setCompiling] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [reloadNonce, setReloadNonce] = useState(0)
  // 编译序号：防抖到期后只让最新一次编译落地，旧结果（含乱序返回）作废
  const compileSeqRef = useRef(0)
  const mountedRef = useRef(false)

  // 自动刷新开关记忆（默认开）
  useEffect(() => {
    try {
      setAutoRefresh(localStorage.getItem(AUTO_KEY) !== '0')
    } catch {
      /* 存储不可用时保持默认开 */
    }
    mountedRef.current = true
  }, [])

  const toggleAuto = useCallback(() => {
    setAutoRefresh((prev) => {
      const next = !prev
      try {
        localStorage.setItem(AUTO_KEY, next ? '1' : '0')
      } catch {
        /* 存储不可用时仅内存生效 */
      }
      return next
    })
  }, [])

  /** 编译：收集本地 link/script 引用 → 解析内容（打开中优先，其余按需拉取）→ 同步替换 */
  const compile = useCallback(async () => {
    const seq = ++compileSeqRef.current
    setCompiling(true)
    try {
      const baseDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      const resolveRef = (ref: string) => resolveWsRef(baseDir, ref)

      const linkTags = content.match(/<link\b[^>]*>/gi) ?? []
      const scriptTags = content.match(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>\s*<\/script\s*>/gi) ?? []

      // 收集所有本地引用路径（去重），一次性解析内容
      const refPaths = new Set<string>()
      for (const tag of linkTags) {
        if (!/rel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) continue
        const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
        if (!href || NON_LOCAL_RE.test(href)) continue
        refPaths.add(resolveRef(href))
      }
      for (const tag of scriptTags) {
        const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
        if (!src || NON_LOCAL_RE.test(src)) continue
        refPaths.add(resolveRef(src))
      }

      const contents = new Map<string, string | null>()
      await Promise.all(
        [...refPaths].map(async (p) => {
          if (Object.hasOwn(openFiles, p)) {
            contents.set(p, openFiles[p])
          } else {
            try {
              contents.set(p, await resolveFile(p))
            } catch {
              contents.set(p, null) // 拉取失败按不存在处理，引用原样保留
            }
          }
        })
      )

      // link rel=stylesheet → <style>；找不到内容 / 外部引用原样保留
      let out = content.replace(/<link\b[^>]*>/gi, (tag) => {
        if (!/rel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) return tag
        const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
        if (!href || NON_LOCAL_RE.test(href)) return tag
        const css = contents.get(resolveRef(href))
        if (css == null) return tag
        return `<style data-from="${href.replace(/"/g, '&quot;')}">\n${css}\n</style>`
      })
      // script src → 内联 <script>（保留 type 属性，如 type="module"）
      out = out.replace(
        /<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script\s*>/gi,
        (tag, before: string, src: string, after: string) => {
          if (NON_LOCAL_RE.test(src)) return tag
          const js = contents.get(resolveRef(src))
          if (js == null) return tag
          const typeAttr = /type\s*=\s*["']([^"']+)["']/i.exec(before + after)?.[1]
          const attrs = typeAttr ? ` type="${typeAttr}"` : ''
          return `<script${attrs} data-from="${src.replace(/"/g, '&quot;')}">\n${js}\n</script>`
        }
      )

      // 只让最新一次编译落地
      if (compileSeqRef.current === seq) setCompiled(out)
    } finally {
      if (compileSeqRef.current === seq) setCompiling(false)
    }
  }, [content, openFiles, path, resolveFile])

  // 首次挂载 / 文件切换：强制编译一次
  useEffect(() => {
    void compile()
  }, [path])

  // 自动刷新：content 变化防抖 600ms 后重新编译（手动模式不触发）
  useEffect(() => {
    if (!autoRefresh || !mountedRef.current) return
    const t = setTimeout(() => void compile(), 600)
    return () => clearTimeout(t)
  }, [content, autoRefresh, compile])

  const openInNewTab = useCallback(() => {
    if (!compiled) return
    const url = URL.createObjectURL(new Blob([compiled], { type: 'text/html' }))
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }, [compiled])

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-card">
      {/* 预览工具条 */}
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border bg-secondary/40 px-2">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Eye className="h-3 w-3 text-clay" />
          预览
        </span>
        <label
          className="ml-1 flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground"
          title="编辑时自动重新渲染预览（防抖 0.6s）"
        >
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={toggleAuto}
            className="h-3 w-3 accent-[#c96342]"
            aria-label="自动刷新预览"
          />
          自动刷新
        </label>
        <span className="ml-auto flex items-center gap-0.5">
          {compiling && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          <button
            type="button"
            onClick={() => {
              void compile()
              setReloadNonce((n) => n + 1)
            }}
            disabled={compiling}
            title="重新编译并重载预览（内联本地 CSS/JS 后渲染）"
            aria-label="刷新预览"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-clay disabled:opacity-50"
          >
            <RotateCw className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={openInNewTab}
            disabled={!compiled}
            title="在新标签页打开编译后的页面（含内联资源）"
            aria-label="在新标签页打开预览"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-clay disabled:opacity-50"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        </span>
      </div>
      {/* 沙箱 iframe：allow-scripts 跑内联脚本 / 表单 / alert / 链接跳出；无 allow-same-origin */}
      {content.trim() ? (
        <iframe
          key={`${path}-${reloadNonce}`}
          title={`HTML 预览：${path}`}
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          srcDoc={compiled || content}
          className="h-full w-full flex-1 border-0 bg-white"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          HTML 文件为空，输入内容后自动预览
        </div>
      )}
    </div>
  )
}
