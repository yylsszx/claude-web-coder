# Claude 风格 AI 编程工作台

> 类 Cline / Claude Code 的网页版 AI 编程助手 —— 左侧文件树 + 中间代码编辑器 + 右侧 AI 对话三栏布局。

![工作台截图](docs/screenshots/workspace-desktop.png)

## 功能特性

### 🗂 文件树（左栏）
- 新建文件（支持 `src/utils/helpers.ts` 形式的目录路径）
- 重命名 / 移动、删除（带确认）
- 目录树自动折叠展开，激活文件高亮

### ✏️ 代码编辑器（中栏）
- 基于 CodeMirror 6：语法高亮（JS/TS/Python/HTML/CSS/JSON/Markdown/SQL）、行号、括号匹配、自动补全
- **自动保存**：停止输入 1 秒后自动保存，`Ctrl/⌘ + S` 可手动立即保存
- 保存状态实时指示（已保存 / 未保存 / 保存中）

### 🤖 AI 助手（右栏）
- 后端通过 `z-ai-web-dev-sdk` 调用 GLM 大模型实现代码**生成、解释、修改**
- 多轮对话，历史记录持久化（SQLite / Prisma）
- 快捷指令：解释当前文件 / 优化当前文件 / 修复 Bug（自动携带当前编辑器内容作为上下文）
- AI 回复完整渲染 Markdown；每个代码块支持**一键复制**与**一键应用到当前文件**（写入编辑器并自动保存）

### 🎨 Claude 风格 UI
- 米白奶油底色（`#FAF9F5`）+ terracotta 陶土橙点缀（`#D97757`）
- 衬线标题字体、圆角卡片、简洁留白
- 响应式：桌面端三栏可拖拽调整宽度（`react-resizable-panels`），移动端自动切换为 Tab 布局

## 技术栈

| 层 | 技术 |
| --- | --- |
| 框架 | Next.js 16（App Router）+ TypeScript 5 + React 19 |
| 样式 | Tailwind CSS 4 + shadcn/ui |
| 编辑器 | CodeMirror 6（@uiw/react-codemirror） |
| 数据库 | Prisma ORM + SQLite |
| AI | z-ai-web-dev-sdk（服务端调用） |
| 状态 | React Hooks（客户端） |

## 快速开始

```bash
bun install
bun run db:push   # 初始化 SQLite 数据库
bun run dev       # 开发模式，默认 3000 端口
```

打开首页即为工作台；首次加载会自动写入示例文件（README.md、examples/fibonacci.js、examples/hello.py）与欢迎消息。

## 项目结构

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts        # 聊天记录读写 + AI 调用（POST）
│   │   └── files/               # 文件 CRUD（列表 / 单文件）
│   ├── page.tsx                 # 工作台主页面（三栏编排 + 状态管理）
│   └── globals.css              # Claude 风格主题变量与自定义样式
├── components/workspace/
│   ├── file-tree.tsx            # 文件树（新建/重命名/删除）
│   ├── code-editor.tsx          # CodeMirror 编辑器 + 保存状态
│   ├── chat-panel.tsx           # AI 对话面板 + 快捷指令
│   └── ai-message.tsx           # Markdown 渲染 + 代码块操作
└── lib/
    ├── db.ts                    # Prisma 客户端
    ├── seed.ts                  # 首次启动种子数据
    └── language.ts              # 文件后缀 → 语言推断
```

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。
