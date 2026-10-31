'use client'

import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Check, Copy, FileInput, FilePlus2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface CodeBlockProps {
  language: string
  code: string
  onApply?: (code: string) => void
  applyDisabled?: boolean
  onSaveAs?: (code: string, language: string) => void
}

/** 带操作栏的代码块：复制 / 应用到当前文件 / 存为新文件 */
function CodeBlock({ language, code, onApply, applyDisabled, onSaveAs }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默失败
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-secondary/60 px-3 py-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">
          {language || 'code'}
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
              应用到当前文件
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
        style={oneLight}
        customStyle={{
          margin: 0,
          padding: '12px 14px',
          fontSize: '12.5px',
          background: '#ffffff',
        }}
        wrapLongLines={false}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

interface AiMessageProps {
  content: string
  onApplyCode?: (code: string) => void
  applyDisabled?: boolean
  /** 存为新文件（代码块操作栏） */
  onSaveAsCode?: (code: string, language: string) => void
}

/** 渲染 AI 回复（Markdown + 代码块） */
export const AiMessage = memo(function AiMessage({
  content,
  onApplyCode,
  applyDisabled,
  onSaveAsCode,
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
