/** 根据文件路径推断编程语言（用于编辑器语法高亮） */
export function inferLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    html: 'html',
    htm: 'html',
    css: 'css',
    json: 'json',
    md: 'markdown',
    sql: 'sql',
    sh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    txt: 'plaintext',
  }
  return map[ext] ?? 'plaintext'
}
