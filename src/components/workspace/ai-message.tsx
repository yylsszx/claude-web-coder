'use client'

import { memo, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useTheme } from 'next-themes'
import { useMounted } from '@/hooks/use-mounted'
import { Check, ChevronDown, ChevronUp, Copy, FileInput, FilePlus2, SquarePen } from 'lucide-react'
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
}

/** 渲染 AI 回复（Markdown + 代码块） */
export const AiMessage = memo(function AiMessage({
  content,
  onApplyCode,
  applyDisabled,
  onSaveAsCode,
  onInsertCode,
  insertDisabled,
}: AiMessageProps) {
  return (
    <div className="ai-markdown">
      <ReactMarkdown
        components={{
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
    </div>
  )
})
