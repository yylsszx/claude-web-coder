'use client'

import { memo, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useTheme } from 'next-themes'
import { useMounted } from '@/hooks/use-mounted'
import { Check, ChevronDown, ChevronUp, Copy, Download, FileInput, FilePlus2, Layers, ListChecks, SquarePen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { copyTextToClipboard } from '@/lib/utils'

interface CodeBlockProps {
  language: string
  code: string
  onApply?: (code: string) => void
  applyDisabled?: boolean
  onSaveAs?: (code: string, language: string) => void
  /** 插入到编辑器当前光标位置 */
  onInsert?: (code: string) => void
  insertDisabled?: boolean
}

/** 超过此行数的代码块默认折叠 */
const COLLAPSE_LINES = 28

/** 语言标注 → 下载文件扩展名（覆盖 AI 常见写法，如 python/py、c++/cpp） */
const LANG_EXT: Record<string, string> = {
  python: 'py', py: 'py', ipython: 'py',
  javascript: 'js', js: 'js', jsx: 'jsx', node: 'js',
  typescript: 'ts', ts: 'ts', tsx: 'tsx',
  html: 'html', xml: 'xml', svg: 'svg', vue: 'vue', svelte: 'svelte',
  css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  json: 'json', json5: 'json5', jsonc: 'jsonc',
  markdown: 'md', md: 'md',
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', console: 'sh',
  java: 'java', go: 'go', golang: 'go', rust: 'rs', rs: 'rs',
  c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', 'c#': 'cs', cs: 'cs',
  ruby: 'rb', rb: 'rb', php: 'php', swift: 'swift', kotlin: 'kt', kt: 'kt',
  sql: 'sql', yaml: 'yml', yml: 'yml', toml: 'toml',
  r: 'r', lua: 'lua', perl: 'pl', pl: 'pl', dart: 'dart',
  dockerfile: 'Dockerfile', makefile: 'Makefile', ini: 'ini', env: 'env',
}

/** 把代码块以纯文本下载为对应扩展名的文件 */
function downloadCodeFile(code: string, language: string) {
  const ext = LANG_EXT[language.toLowerCase()] ?? 'txt'
  const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `snippet.${ext}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 解析 Markdown 中的 fenced code block（```lang … ```），与渲染器行为对应，供批量操作使用 */
function parseCodeBlocks(content: string): { language: string; code: string }[] {
  const blocks: { language: string; code: string }[] = []
  let inBlock = false
  let lang = ''
  let buf: string[] = []
  for (const line of content.split('\n')) {
    const fence = /^\s*```(.*)$/.exec(line)
    if (fence) {
      if (!inBlock) {
        inBlock = true
        lang = fence[1].trim().split(/[\s:]+/)[0] ?? ''
        buf = []
      } else {
        inBlock = false
        blocks.push({ language: lang, code: buf.join('\n') })
      }
      continue
    }
    if (inBlock) buf.push(line)
  }
  return blocks
}

/** 带操作栏的代码块：复制 / 应用到文件 / 存为新文件；超长自动折叠 */
function CodeBlock({ language, code, onApply, applyDisabled, onSaveAs, onInsert, insertDisabled }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // 主题语法高亮仅在客户端挂载后跟随 resolvedTheme，避免 SSR 与深色客户端 inline style hydration mismatch
  const mounted = useMounted()
  const { resolvedTheme } = useTheme()
  const isDark = mounted && resolvedTheme === 'dark'
  const lines = useMemo(() => code.split('\n'), [code])
  const collapsible = lines.length > COLLAPSE_LINES
  const shownCode = collapsible && !expanded ? lines.slice(0, COLLAPSE_LINES).join('\n') : code

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(code)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-secondary/60 px-3 py-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">
          {language || 'code'}
          <span className="mx-1.5 opacity-50">·</span>
          {lines.length} 行
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
            {copied ? '已复制' : '复制'}
          </Button>
          {onApply && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px] text-clay hover:text-clay"
              onClick={() => onApply(code)}
              disabled={applyDisabled}
            >
              <FileInput className="h-3 w-3" />
              应用到文件…
            </Button>
          )}
          {onInsert && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 px-0 text-muted-foreground"
              onClick={() => onInsert(code)}
              disabled={insertDisabled}
              aria-label="插入到当前文件光标处"
              title={insertDisabled ? '请先在编辑器中打开一个文件' : '插入到当前文件光标处'}
            >
              <SquarePen className="h-3 w-3" />
            </Button>
          )}
          {onSaveAs && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
              onClick={() => onSaveAs(code, language)}
            >
              <FilePlus2 className="h-3 w-3" />
              存为新文件
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 px-0 text-muted-foreground"
            onClick={() => downloadCodeFile(code, language)}
            aria-label="下载为文件"
            title={`下载为文件（.${LANG_EXT[language.toLowerCase()] ?? 'txt'}）`}
          >
            <Download className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={isDark ? oneDark : oneLight}
        customStyle={{
          margin: 0,
          padding: '12px 14px',
          fontSize: '12.5px',
          background: isDark ? '#282826' : '#ffffff',
        }}
        wrapLongLines={false}
      >
        {shownCode}
      </SyntaxHighlighter>
      {collapsible && (
        <button
          className="flex w-full items-center justify-center gap-1 border-t border-border bg-secondary/40 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-clay"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" />
              收起
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              展开全部 {lines.length} 行（剩余 {lines.length - COLLAPSE_LINES} 行）
            </>
          )}
        </button>
      )}
    </div>
  )
}

interface AiMessageProps {
  content: string
  onApplyCode?: (code: string) => void
  applyDisabled?: boolean
  /** 存为新文件（代码块操作栏） */
  onSaveAsCode?: (code: string, language: string) => void
  /** 插入到编辑器当前光标位置 */
  onInsertCode?: (code: string) => void
  /** 无打开文件时禁用插入 */
  insertDisabled?: boolean
  /** 批量应用：把全部代码块依次走「选目标 → diff 确认」队列（流式生成中不传） */
  onApplyAll?: (codes: string[]) => void
  /** 是否显示批量工具行（≥2 段代码时出现） */
  showBatchTools?: boolean
}

/** 渲染 AI 回复（Markdown + 代码块） */
export const AiMessage = memo(function AiMessage({
  content,
  onApplyCode,
  applyDisabled,
  onSaveAsCode,
  onInsertCode,
  insertDisabled,
  onApplyAll,
  showBatchTools,
}: AiMessageProps) {
  const blocks = useMemo(() => parseCodeBlocks(content), [content])
  const [allCopied, setAllCopied] = useState(false)

  /** 以 Markdown 格式复制全部代码块（保留语言围栏，便于粘贴回对话或文档） */
  const handleCopyAll = async () => {
    const text = blocks
      .map((b) => '```' + b.language + '\n' + b.code + '\n```')
      .join('\n\n')
    const ok = await copyTextToClipboard(text)
    if (ok) {
      setAllCopied(true)
      setTimeout(() => setAllCopied(false), 1500)
    }
  }

  return (
    <div className="ai-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          /** GFM 表格：横向滚动容器 + Claude 风样式（对齐样式由 remark-gfm 透传到单元格） */
          table({ children }) {
            return (
              <div className="thin-scrollbar my-2 overflow-x-auto rounded-lg border border-border">
                <table className="w-full border-collapse text-[12.5px] leading-relaxed">{children}</table>
              </div>
            )
          },
          thead({ children }) {
            return <thead className="bg-secondary/60">{children}</thead>
          },
          tr({ children }) {
            return <tr className="border-b border-border/60 last:border-b-0">{children}</tr>
          },
          th({ children, node: _node, ...rest }) {
            return (
              <th
                className="border-b border-border px-3 py-1.5 text-left font-medium text-foreground/90"
                {...rest}
              >
                {children}
              </th>
            )
          },
          td({ children, node: _node, ...rest }) {
            return (
              <td className="border-b border-border/40 px-3 py-1.5 align-top" {...rest}>
                {children}
              </td>
            )
          },
          del({ children }) {
            return <del className="text-muted-foreground/70">{children}</del>
          },
          /** GFM 任务列表复选框：只读展示 */
          input({ node: _node, ...rest }) {
            return (
              <input
                {...rest}
                disabled
                readOnly
                className="mr-1.5 h-3.5 w-3.5 translate-y-0.5 accent-clay"
              />
            )
          },
          code(props) {
            const { className, children } = props
            const match = /language-([\w-]+)/.exec(className ?? '')
            if (match) {
              const code = String(children).replace(/\n$/, '')
              return (
                <CodeBlock
                  language={match[1]}
                  code={code}
                  onApply={onApplyCode}
                  applyDisabled={applyDisabled}
                  onSaveAs={onSaveAsCode}
                  onInsert={onInsertCode}
                  insertDisabled={insertDisabled}
                />
              )
            }
            return <code className={className}>{children}</code>
          },
          pre(props) {
            // 语言块已被 code 重写为 CodeBlock（div），直接透传；
            // 无语言标注的代码块则套一层带样式的 <pre>
            const child = Array.isArray(props.children)
              ? props.children[0]
              : props.children
            const childClassName =
              child && typeof child === 'object' && 'props' in child
                ? String((child.props as { className?: string })?.className ?? '')
                : ''
            if (/language-/.test(childClassName)) {
              return <>{props.children}</>
            }
            return (
              <pre className="thin-scrollbar my-2 overflow-x-auto rounded-lg border border-border bg-card p-3 font-mono text-[12.5px] leading-relaxed">
                {props.children}
              </pre>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {showBatchTools && blocks.length >= 2 && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-border/50 pt-1.5">
          <Layers className="h-3 w-3 shrink-0 text-clay" />
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {blocks.length} 段代码
          </span>
          {onApplyAll && (
            <button
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-clay transition-colors hover:bg-clay/10"
              onClick={() => onApplyAll(blocks.map((b) => b.code))}
              title="依次为每段代码选择目标文件并确认 diff"
            >
              <ListChecks className="h-3 w-3" />
              应用全部…
            </button>
          )}
          <button
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-clay"
            onClick={() => void handleCopyAll()}
            title="以 Markdown 格式复制全部代码块"
          >
            {allCopied ? (
              <>
                <Check className="h-3 w-3 text-green-600" />
                已复制
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                复制全部
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
})
