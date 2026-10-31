import { db } from '@/lib/db'
import { getOrCreateDefaultSession } from '@/lib/session'

const SAMPLE_FILES: { path: string; content: string; language: string }[] = [
  {
    path: 'README.md',
    language: 'markdown',
    content: `# 欢迎 ✨

这是一个 **Claude 风格的网页版 AI 编程工作台**。

## 使用方法

1. 左侧「文件树」：新建 / 重命名 / 删除文件
2. 中间「编辑器」：直接编辑代码，自动保存（也可 Ctrl/⌘ + S 手动保存）
3. 右侧「AI 对话」：让 AI 生成、解释、优化代码，点击代码块上的「应用到当前文件」一键写入编辑器

## 快捷指令

- 解释当前文件
- 优化当前文件
- 修复 Bug

祝你编码愉快！
`,
  },
  {
    path: 'examples/fibonacci.js',
    language: 'javascript',
    content: `/**
 * 计算斐波那契数列第 n 项（记忆化版本，O(n)）
 */
const memo = new Map();

function fibonacci(n) {
  if (n <= 1) return n;
  if (memo.has(n)) return memo.get(n);

  const value = fibonacci(n - 1) + fibonacci(n - 2);
  memo.set(n, value);
  return value;
}

// 打印前 10 项
for (let i = 0; i < 10; i++) {
  console.log(fibonacci(i));
}
`,
  },
  {
    path: 'examples/hello.py',
    language: 'python',
    content: `"""一个简单的问候程序"""


def greet(name: str) -> str:
    return f"Hello, {name}!"


if __name__ == "__main__":
    for who in ["Claude", "Cline", "World"]:
        print(greet(who))
`,
  },
]

const WELCOME_MESSAGE = `你好！我是你的 AI 编程助手 👋

我可以帮你：

- **生成代码**：描述需求，我直接给出可运行的实现
- **解释代码**：点击「解释当前文件」，我会逐段讲解
- **优化与修复**：改进现有代码的质量、性能与健壮性

试试在下方输入你的第一个需求，或者直接对当前打开的文件提问。`

/**
 * 确保数据库有初始种子数据（仅首次为空时写入）
 */
export async function ensureSeed() {
  const fileCount = await db.projectFile.count()
  if (fileCount === 0) {
    await db.projectFile.createMany({ data: SAMPLE_FILES })
  }

  const sessionCount = await db.chatSession.count()
  if (sessionCount === 0) {
    const session = await getOrCreateDefaultSession()
    await db.chatMessage.create({
      data: { sessionId: session.id, role: 'assistant', content: WELCOME_MESSAGE },
    })
  }
}
