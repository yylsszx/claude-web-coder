# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。

## [0.2.0] - 2026-10-31

### 新增
- **AI 流式输出**：新增 `POST /api/chat/stream`，服务端将上游 SSE 增量解析为标准帧（`delta` / `done` / `error`）推送到前端；回复逐字呈现并带打字机光标，流式结束后自动落库（含中断时部分内容抢救），前端按 60ms 批量渲染避免高频重绘
- **多标签页编辑**：编辑器顶部标签栏，可同时打开多个文件，点击切换、关闭；未保存标签显示橙点标记，切换/关闭时自动保存未落盘内容；`Ctrl/⌘ + S` 作用于当前激活标签

### 优化
- 编辑器以文件 ID 为 key 干净重挂载，杜绝跨文件状态串扰；光标位置与撤销历史在标签切换后从文件当前状态重新开始
- AI 回复流式渲染期间禁用「应用到当前文件」按钮，防止不完整代码被误写入

## [0.1.0] - 2026-10-31

首个可用版本：搭建完整的网页版 AI 编程工作台骨架。

### 新增
- **三栏工作台布局**：左侧文件树 / 中间代码编辑器 / 右侧 AI 对话，桌面端基于 `react-resizable-panels` 支持拖拽调宽；移动端自动切换为 Tab 布局
- **文件管理**：新建（支持多级目录路径）、重命名 / 移动、删除（带确认对话框），目录树折叠展开
- **代码编辑器**：CodeMirror 6，支持 JavaScript / TypeScript / Python / HTML / CSS / JSON / Markdown / SQL 语法高亮、行号、括号匹配、自动补全；停止输入 1 秒自动保存，`Ctrl/⌘ + S` 手动保存，保存状态实时指示
- **AI 编程助手**：
  - 服务端通过 `z-ai-web-dev-sdk` 调用大模型，支持代码生成、解释、修改
  - 多轮对话与历史持久化（Prisma + SQLite）
  - 快捷指令（解释 / 优化 / 修复 Bug），自动携带当前文件内容作为上下文
  - AI 回复 Markdown 渲染，代码块支持一键复制、一键应用到当前文件并自动保存
- **Claude 风格主题**：米白奶油底色 + terracotta 陶土橙点缀 + 衬线标题 + 圆角卡片；自定义滚动条与 CodeMirror 主题融合
- **数据层**：Prisma schema（`ProjectFile` / `ChatMessage`），首次启动自动写入示例文件与欢迎消息
- **API**：`GET/POST /api/files`、`GET/PUT/DELETE /api/files/[id]`、`GET/POST/DELETE /api/chat`

### 自测
- ESLint 0 错误 0 警告
- Agent Browser 端到端验证：三栏渲染、文件打开与自动保存、AI 对话完整链路、代码块应用、新建文件、移动端布局，控制台无报错
