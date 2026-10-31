"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "next-themes";
import { useMounted } from "@/hooks/use-mounted";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileInput,
  FilePlus2,
  Layers,
  ListChecks,
  ListTree,
  SquarePen,
  WrapText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyTextToClipboard } from "@/lib/utils";

interface CodeBlockProps {
  language: string;
  code: string;
  onApply?: (code: string) => void;
  applyDisabled?: boolean;
  onSaveAs?: (code: string, language: string) => void;
  /** 插入到编辑器当前光标位置 */
  onInsert?: (code: string) => void;
  insertDisabled?: boolean;
}

/** 超过此行数的代码块默认折叠 */
const COLLAPSE_LINES = 28;

/** 可实时预览的语言：完整 HTML 文档与 SVG（sandbox iframe 内 srcDoc 渲染，脚本隔离运行） */
const PREVIEWABLE_LANGS = new Set(["html", "svg"]);

/** 语言标注 → 下载文件扩展名（覆盖 AI 常见写法，如 python/py、c++/cpp） */
const LANG_EXT: Record<string, string> = {
  python: "py",
  py: "py",
  ipython: "py",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  node: "js",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  html: "html",
  xml: "xml",
  svg: "svg",
  vue: "vue",
  svelte: "svelte",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  json: "json",
  json5: "json5",
  jsonc: "jsonc",
  markdown: "md",
  md: "md",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  zsh: "sh",
  console: "sh",
  java: "java",
  go: "go",
  golang: "go",
  rust: "rs",
  rs: "rs",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "cs",
  "c#": "cs",
  cs: "cs",
  ruby: "rb",
  rb: "rb",
  php: "php",
  swift: "swift",
  kotlin: "kt",
  kt: "kt",
  sql: "sql",
  yaml: "yml",
  yml: "yml",
  toml: "toml",
  r: "r",
  lua: "lua",
  perl: "pl",
  pl: "pl",
  dart: "dart",
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  ini: "ini",
  env: "env",
};

/** 把代码块以纯文本下载为对应扩展名的文件 */
function downloadCodeFile(code: string, language: string) {
  const ext = LANG_EXT[language.toLowerCase()] ?? "txt";
  const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `snippet.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 解析 Markdown 中的 fenced code block（```lang … ```），与渲染器行为对应，供批量操作使用 */
function parseCodeBlocks(
  content: string,
): { language: string; code: string }[] {
  const blocks: { language: string; code: string }[] = [];
  let inBlock = false;
  let lang = "";
  let buf: string[] = [];
  for (const line of content.split("\n")) {
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      if (!inBlock) {
        inBlock = true;
        lang = fence[1].trim().split(/[\s:]+/)[0] ?? "";
        buf = [];
      } else {
        inBlock = false;
        blocks.push({ language: lang, code: buf.join("\n") });
      }
      continue;
    }
    if (inBlock) buf.push(line);
  }
  return blocks;
}

/** 带操作栏的代码块：复制 / 应用到文件 / 存为新文件；超长自动折叠 */
function CodeBlock({
  language,
  code,
  onApply,
  applyDisabled,
  onSaveAs,
  onInsert,
  insertDisabled,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // 自动换行：默认关闭（横向滚动）；长 URL / minified 代码可一键折行显示，
  // 折行用容器类 .code-block-wrap 强制（库的 wrapLongLines 会被主题默认样式覆盖），开启时隐藏行号避免错位
  const [wrap, setWrap] = useState(false);
  // 实时预览（仅 html / svg 代码块）：sandbox iframe 内渲染，脚本可跑但与页面完全隔离
  const previewable = PREVIEWABLE_LANGS.has(language.toLowerCase());
  const [previewOpen, setPreviewOpen] = useState(false);
  // 预览内容防抖：流式生成时代码逐字增长，直接同步会每 chunk 重载一次 iframe 闪烁
  const [previewCode, setPreviewCode] = useState(code);
  useEffect(() => {
    const t = setTimeout(() => setPreviewCode(code), 400);
    return () => clearTimeout(t);
  }, [code]);
  // 主题语法高亮仅在客户端挂载后跟随 resolvedTheme，避免 SSR 与深色客户端 inline style hydration mismatch
  const mounted = useMounted();
  const { resolvedTheme } = useTheme();
  const isDark = mounted && resolvedTheme === "dark";
  const lines = useMemo(() => code.split("\n"), [code]);
  const collapsible = lines.length > COLLAPSE_LINES;
  const shownCode =
    collapsible && !expanded ? lines.slice(0, COLLAPSE_LINES).join("\n") : code;

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div
      className={`my-2 overflow-hidden rounded-lg border border-border ${wrap ? "code-block-wrap" : ""}`}
    >
      <div className="flex items-center gap-2 border-b border-border bg-secondary/60 px-3 py-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">
          {language || "code"}
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
            {copied ? (
              <Check className="h-3 w-3 text-green-600" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copied ? "已复制" : "复制"}
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
              title={
                insertDisabled
                  ? "请先在编辑器中打开一个文件"
                  : "插入到当前文件光标处"
              }
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
            title={`下载为文件（.${LANG_EXT[language.toLowerCase()] ?? "txt"}）`}
          >
            <Download className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-6 w-6 px-0 ${wrap ? "text-clay" : "text-muted-foreground"}`}
            onClick={() => setWrap((v) => !v)}
            aria-label="切换自动换行"
            aria-pressed={wrap}
            title={wrap ? "关闭自动换行（长行横向滚动）" : "自动换行（长行折叠显示，隐藏行号）"}
          >
            <WrapText className="h-3 w-3" />
          </Button>
          {previewable && (
            <Button
              variant="ghost"
              size="sm"
              className={`h-6 w-6 px-0 ${previewOpen ? "text-clay" : "text-muted-foreground"}`}
              onClick={() => setPreviewOpen((v) => !v)}
              aria-label={previewOpen ? "关闭预览" : "预览渲染效果"}
              aria-pressed={previewOpen}
              title={previewOpen ? "关闭预览" : "预览渲染效果（沙箱内运行，脚本与页面隔离）"}
            >
              {previewOpen ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </Button>
          )}
        </div>
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={isDark ? oneDark : oneLight}
        showLineNumbers={!wrap}
        lineNumberStyle={{
          color: isDark ? "#6b6a66" : "#c8c6c0",
          minWidth: "2.4em",
          paddingRight: "10px",
          userSelect: "none",
        }}
        customStyle={{
          margin: 0,
          padding: "12px 14px",
          fontSize: "12.5px",
          background: isDark ? "#282826" : "#ffffff",
        }}
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
              展开全部 {lines.length} 行（剩余 {lines.length - COLLAPSE_LINES}{" "}
              行）
            </>
          )}
        </button>
      )}
      {previewOpen && (
        <iframe
          title="代码块预览"
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          srcDoc={previewCode}
          className="h-56 w-full border-0 border-t border-border bg-white"
        />
      )}
    </div>
  );
}

interface AiMessageProps {
  content: string;
  onApplyCode?: (code: string) => void;
  applyDisabled?: boolean;
  /** 存为新文件（代码块操作栏） */
  onSaveAsCode?: (code: string, language: string) => void;
  /** 插入到编辑器当前光标位置 */
  onInsertCode?: (code: string) => void;
  /** 无打开文件时禁用插入 */
  insertDisabled?: boolean;
  /** 批量应用：把全部代码块依次走「选目标 → diff 确认」队列（流式生成中不传） */
  onApplyAll?: (codes: string[]) => void;
  /** 是否显示批量工具行（≥2 段代码时出现） */
  showBatchTools?: boolean;
  /** 该消息是否正在流式生成（生成中不折叠，结束后按实际高度折叠） */
  streaming?: boolean;
  /** 勾选 / 取消任务列表项：传入后 checkbox 可交互（回调得到替换后的完整 Markdown）；流式生成中不传 → 只读 */
  onToggleTask?: (newContent: string) => void;
  /** 工作区已知文件列表：行内代码命中文件路径时点亮为可点击 */
  knownFiles?: { id: string; path: string }[];
  /** 点击命中的文件回调（打开该文件）；与 knownFiles 同时传入才生效 */
  onOpenFile?: (id: string) => void;
}

/** 折叠阈值：内容超过此高度显示「展开全文」（px） */
const COLLAPSE_HEIGHT = 420;
/** 迟滞量：避免临界高度抖动（px） */
const COLLAPSE_HYSTERESIS = 48;

/** 找 content 中第 nth 个任务项的行号（跳过 ``` / ~~~ 围栏代码块内的假任务行；缩进限 0-3 空格排除缩进代码块） */
function findTaskLineIdx(content: string, nth: number): number | null {
  const lines = content.split("\n");
  let count = 0;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^ {0,3}(?:[-*+]|\d+[.)])\s+\[[ xX]\]/.test(lines[i])) {
      if (count === nth) return i;
      count++;
    }
  }
  return null;
}

/** inline 代码是否命中已知文件：精确路径优先，其次唯一 basename（必须含扩展名，避免误点普通单词）；同名多文件不点亮防歧义 */
function matchKnownFile(
  text: string,
  files: AiMessageProps["knownFiles"],
): string | null {
  if (!files || files.length === 0) return null;
  const v = text.trim();
  if (!v || v.length > 120 || /\s/.test(v)) return null;
  const exact = files.find((f) => f.path === v);
  if (exact) return exact.id;
  if (!v.includes(".")) return null;
  const base = v.split("/").pop()!.toLowerCase();
  const hits = files.filter(
    (f) =>
      f.path.toLowerCase() === base || f.path.toLowerCase().endsWith("/" + base),
  );
  return hits.length === 1 ? hits[0].id : null;
}

/** 统计 content 中的 GFM 任务项总数与已完成数（与 findTaskLineIdx 同款判定：跳过 ``` / ~~~ 围栏内假任务行，缩进限 0-3 空格排除缩进代码块） */
function countTasks(content: string): { total: number; done: number } {
  const lines = content.split("\n");
  let total = 0;
  let done = 0;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^ {0,3}(?:[-*+]|\d+[.)])\s+\[([ xX])\]/.exec(line);
    if (m) {
      total++;
      if (m[1] !== " ") done++;
    }
  }
  return { total, done };
}

/** 解析 content 的 ATX 标题（# ~ ####；跳过 ``` / ~~~ 围栏内假标题，缩进限 0-3 空格），供长回复目录使用 */
function parseHeadings(content: string): { level: number; text: string }[] {
  const lines = content.split("\n");
  const out: { level: number; text: string }[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^ {0,3}(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2] });
  }
  return out;
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
  streaming = false,
  onToggleTask,
  knownFiles,
  onOpenFile,
}: AiMessageProps) {
  const blocks = useMemo(() => parseCodeBlocks(content), [content]);
  // 任务列表进度：有任务项时在内容底部显示「任务 2/5」+ 迷你进度条（勾选后随 content 实时刷新）
  const taskStats = useMemo(() => countTasks(content), [content]);
  // 标题目录：≥3 个标题的长回复在底部提供可展开目录，点击滚动到对应标题
  const headings = useMemo(() => parseHeadings(content), [content]);
  const [tocOpen, setTocOpen] = useState(false);
  // 目录高亮：当前滚动位置对应的标题序号，目录展开时跟随滚动实时刷新
  const [activeHeading, setActiveHeading] = useState(-1);
  const tocListRef = useRef<HTMLUListElement | null>(null);
  const [allCopied, setAllCopied] = useState(false);
  // 任务列表渲染序号：components 按文档序被调用，自增得到「第 N 个 checkbox」；
  // remark-rehype 合成的 input 无源 position，靠它与源文任务行配对
  let taskSeq = 0;
  // 标题渲染序号：同上按文档序自增，打在 data-heading-idx 上供目录点击定位（与 parseHeadings 的文档序一致）
  let headingSeq = 0;
  
  // ===== 长消息折叠 / 展开 =====
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // 渲染后测量内容实际高度（流式期间 content 持续增长会反复触发，React 对相同值自动去重）
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const over = el.scrollHeight > COLLAPSE_HEIGHT + COLLAPSE_HYSTERESIS;
    setOverflowing(over);
    if (!over) setExpanded(false); // 内容变短（如重新生成出短回复）时自动复位
  }, [content]);

  const collapsed = overflowing && !expanded && !streaming;

  /** 目录点击：滚动到对应标题（折叠中先展开全文再滚，等一拍让内容先撑开） */
  const scrollToHeading = (idx: number) => {
    const el = bodyRef.current?.querySelector(`[data-heading-idx="${idx}"]`);
    if (!el) return;
    setActiveHeading(idx);
    if (collapsed) setExpanded(true);
    window.setTimeout(
      () => el.scrollIntoView({ block: "start", behavior: "smooth" }),
      collapsed ? 80 : 0,
    );
  };

  /** 沿 DOM 向上找第一个滚动祖先（消息在聊天面板滚动容器内滚动，window 兒底） */
  const getScrollParent = (el: HTMLElement | null): HTMLElement | null => {
    let node = el?.parentElement ?? null;
    while (node) {
      const oy = getComputedStyle(node).overflowY;
      if (oy === "auto" || oy === "scroll") return node;
      node = node.parentElement;
    }
    return null;
  };

  // 目录展开时监听滚动祖先：把「容器顶部线（容器顶 + 96px）以上最靠下的标题」记为当前节；
  // 流式 / 展开 / 折叠状态变化也重算一次。rAF 节流，卸载与依赖变化时清理
  useEffect(() => {
    if (!tocOpen || collapsed) return;
    const body = bodyRef.current;
    if (!body) return;
    const sp = getScrollParent(body);
    let raf = 0;
    const update = () => {
      raf = 0;
      const heads = Array.from(
        body.querySelectorAll<HTMLElement>("[data-heading-idx]"),
      );
      if (heads.length === 0) return;
      const topLimit = (sp?.getBoundingClientRect().top ?? 0) + 96;
      let cur = 0;
      for (let i = 0; i < heads.length; i++) {
        if (heads[i].getBoundingClientRect().top <= topLimit) cur = i;
        else break;
      }
      setActiveHeading((prev) => (prev === cur ? prev : cur));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    sp?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      sp?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [tocOpen, collapsed, expanded, content, streaming]);

  // 高亮目录项保持在目录列表可视区内（手动调 scrollTop，避免 scrollIntoView 波及外层滚动）
  useEffect(() => {
    const list = tocListRef.current;
    if (!list || activeHeading < 0) return;
    const item = list.children[activeHeading] as HTMLElement | undefined;
    if (!item) return;
    const lr = list.getBoundingClientRect();
    const ir = item.getBoundingClientRect();
    if (ir.top < lr.top + 2) list.scrollTop += ir.top - lr.top;
    else if (ir.bottom > lr.bottom - 2) list.scrollTop += ir.bottom - lr.bottom;
  }, [activeHeading, tocOpen]);

  /** 以 Markdown 格式复制全部代码块（保留语言围栏，便于粘贴回对话或文档） */
  const handleCopyAll = async () => {
    const text = blocks
      .map((b) => "```" + b.language + "\n" + b.code + "\n```")
      .join("\n\n");
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 1500);
    }
  };

  return (
    <div className="ai-markdown">
      <div className="relative">
        <div
          ref={bodyRef}
          className={collapsed ? "overflow-hidden" : undefined}
          style={collapsed ? { maxHeight: COLLAPSE_HEIGHT } : undefined}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              /** 标题打 data-heading-idx（渲染序号 = 源文标题序，parseHeadings 同序）：供目录点击定位；保留原标签名以继承 .ai-markdown 标题样式 */
              h1({ children }) {
                return <h1 data-heading-idx={headingSeq++}>{children}</h1>;
              },
              h2({ children }) {
                return <h2 data-heading-idx={headingSeq++}>{children}</h2>;
              },
              h3({ children }) {
                return <h3 data-heading-idx={headingSeq++}>{children}</h3>;
              },
              h4({ children }) {
                return <h4 data-heading-idx={headingSeq++}>{children}</h4>;
              },
              /** GFM 表格：横向滚动容器 + Claude 风样式（对齐样式由 remark-gfm 透传到单元格） */
              table({ children }) {
                return (
                  <div className="thin-scrollbar my-2 overflow-x-auto rounded-lg border border-border">
                    <table className="w-full border-collapse text-[12.5px] leading-relaxed">
                      {children}
                    </table>
                  </div>
                );
              },
              thead({ children }) {
                return <thead className="bg-secondary/60">{children}</thead>;
              },
              tr({ children }) {
                return (
                  <tr className="border-b border-border/60 last:border-b-0">
                    {children}
                  </tr>
                );
              },
              th({ children, node: _node, ...rest }) {
                return (
                  <th
                    className="border-b border-border px-3 py-1.5 text-left font-medium text-foreground/90"
                    {...rest}
                  >
                    {children}
                  </th>
                );
              },
              td({ children, node: _node, ...rest }) {
                return (
                  <td
                    className="border-b border-border/40 px-3 py-1.5 align-top"
                    {...rest}
                  >
                    {children}
                  </td>
                );
              },
              del({ children }) {
                return (
                  <del className="text-muted-foreground/70">{children}</del>
                );
              },
              /** 引用块：clay 左竖线 + 微底色，与整体主题统一（默认裸 blockquote 太素） */
              blockquote({ children }) {
                return (
                  <blockquote className="my-2 border-l-[3px] border-clay/50 bg-clay/5 py-1 pl-3 pr-2 text-[12.5px] text-foreground/80 [&>p]:my-0.5">
                    {children}
                  </blockquote>
                );
              },
              /** 分隔线：弱化边框，避免默认 <hr> 在米白底上过于突兀 */
              hr() {
                return <hr className="my-3 border-0 border-t border-border/70" />;
              },
              /** GFM 任务列表复选框：可勾选时按渲染序号定位源文行互换 [ ] ↔ [x] 并回调持久化；无回调（流式中）只读 */
              input({ node: _node, ...rest }) {
                const myIndex = taskSeq++;
                const canToggle = !!onToggleTask;
                return (
                  <input
                    {...rest}
                    checked={Boolean(rest.checked)}
                    disabled={!canToggle}
                    title={canToggle ? '勾选 / 取消待办' : undefined}
                    className="mr-1.5 h-3.5 w-3.5 translate-y-0.5 accent-clay"
                    onChange={() => {
                      if (!onToggleTask) return;
                      const lines = content.split("\n");
                      const idx = findTaskLineIdx(content, myIndex);
                      if (idx === null) return;
                      const toggled = lines[idx].replace(
                        /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/,
                        (
                          _m: string,
                          head: string,
                          mark: string,
                          tail: string,
                        ) => head + (mark === ' ' ? 'x' : ' ') + tail,
                      );
                      if (toggled === lines[idx]) return;
                      lines[idx] = toggled;
                      onToggleTask(lines.join("\n"));
                    }}
                  />
                );
              },
              /** 链接一律新窗口打开，避免点击后整页跳走丢失工作台状态 */
              a({ children, href }) {
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-clay underline decoration-clay/40 underline-offset-2 transition-colors hover:decoration-clay"
                  >
                    {children}
                  </a>
                );
              },
              code(props) {
                const { className, children } = props;
                const match = /language-([\w-]+)/.exec(className ?? "");
                if (match) {
                  const code = String(children).replace(/\n$/, "");
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
                  );
                }
                // 行内代码命中工作区文件路径 → 点亮为可点击按钮（打开该文件）；
                // 保留 <code> 标签以继承既有行内代码样式，button 仅负责交互
                const fileId = matchKnownFile(String(children ?? ""), knownFiles);
                if (fileId && onOpenFile) {
                  return (
                    <button
                      type="button"
                      onClick={() => onOpenFile(fileId)}
                      title={`打开 ${String(children).trim()}`}
                      className="inline-flex cursor-pointer items-center rounded transition-shadow hover:ring-1 hover:ring-clay/60"
                    >
                      <code className="text-clay underline decoration-clay/40 underline-offset-2 hover:decoration-clay">
                        {children}
                      </code>
                    </button>
                  );
                }
                return <code className={className}>{children}</code>;
              },
              pre(props) {
                // 语言块已被 code 重写为 CodeBlock（div），直接透传；
                // 无语言标注的代码块则套一层带样式的 <pre>
                const child = Array.isArray(props.children)
                  ? props.children[0]
                  : props.children;
                const childClassName =
                  child && typeof child === "object" && "props" in child
                    ? String(
                        (child.props as { className?: string })?.className ??
                          "",
                      )
                    : "";
                if (/language-/.test(childClassName)) {
                  return <>{props.children}</>;
                }
                return (
                  <pre className="thin-scrollbar my-2 overflow-x-auto rounded-lg border border-border bg-card p-3 font-mono text-[12.5px] leading-relaxed">
                    {props.children}
                  </pre>
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
        {collapsed && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-card to-transparent"
            aria-hidden
          />
        )}
        {overflowing && !streaming && (
          <button
            className={`relative z-10 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-clay transition-colors hover:bg-clay/10 ${
              collapsed ? "-mt-1.5" : "mt-1.5"
            }`}
            onClick={() => setExpanded((v) => !v)}
            title={collapsed ? "展开完整回复" : "收起回复"}
          >
            {collapsed ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
            {collapsed ? "展开全文" : "收起"}
          </button>
        )}
      </div>
      {/* 标题目录：≥3 个标题的长回复提供快速跳转（代码围栏内的假标题不计数） */}
      {headings.length >= 3 && (
        <div className="mt-2 border-t border-border/50 pt-1.5">
          <button
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-clay"
            onClick={() => setTocOpen((v) => !v)}
            title="快速跳转到回复内各标题"
          >
            <ListTree className="h-3 w-3 shrink-0 text-clay" />
            <span className="shrink-0">目录 · {headings.length} 节</span>
            {tocOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {tocOpen && (
            <ul
              ref={tocListRef}
              className="thin-scrollbar mt-1 max-h-40 space-y-0.5 overflow-y-auto"
            >
              {headings.map((h, i) => (
                <li key={i}>
                  <button
                    className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[11.5px] transition-colors hover:bg-clay/10 hover:text-clay ${
                      i === activeHeading
                        ? "bg-clay/10 font-medium text-clay"
                        : "text-foreground/75"
                    } ${h.level > 2 ? "pl-4" : ""}`}
                    onClick={() => scrollToHeading(i)}
                    aria-current={i === activeHeading ? "location" : undefined}
                    title={h.text}
                  >
                    {h.level === 1 ? `# ${h.text}` : h.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {taskStats.total > 0 && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-border/50 pt-1.5">
          <ListChecks className="h-3 w-3 shrink-0 text-clay" />
          <span className="shrink-0 text-[11px] text-muted-foreground">
            任务 {taskStats.done}/{taskStats.total}
            {taskStats.done === taskStats.total ? " · 全部完成" : ""}
          </span>
          <div
            className="h-1 w-16 overflow-hidden rounded-full bg-secondary"
            title={`${taskStats.done} / ${taskStats.total} 已完成`}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                taskStats.done === taskStats.total ? "bg-green-600" : "bg-clay"
              }`}
              style={{
                width: `${Math.round((taskStats.done / taskStats.total) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
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
  );
});
