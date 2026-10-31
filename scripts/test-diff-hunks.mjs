/* 验证 diff-dialog 逐块应用重建逻辑（与组件内实现一致） */
import { diffLines } from 'diff'

const original = 'def greet(name):\n    print("hello " + name)\n    return True\n\ndef bye():\n    print("bye")\n    return False\n\n# end\n'
// AI 代码块（parseCodeBlocks 提取后末尾无换行 → 产生末行幻影块）
const incoming = 'def greet(name):\n    print(f"hello {name}")\n    return True\n\ndef bye():\n    print("bye", "see you")\n    return False\n\n# end'

function buildRows(original, incoming) {
  const parts = diffLines(original, incoming)
  const rows = []
  for (const part of parts) {
    const type = part.added ? 'add' : part.removed ? 'del' : 'same'
    const lines = part.value.split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    for (const line of lines) rows.push({ type, text: line })
  }
  return rows
}

function buildHunks(rows) {
  const hunks = []
  const rowHunk = []
  rows.forEach((row, i) => {
    if (row.type === 'same') { rowHunk.push(null); return }
    const prev = i > 0 ? rowHunk[i - 1] : null
    if (prev !== null) {
      rowHunk.push(prev)
      const h = hunks[prev]
      if (row.type === 'add') h.add++
      else h.del++
    } else {
      const id = hunks.length
      hunks.push({ id, add: row.type === 'add' ? 1 : 0, del: row.type === 'del' ? 1 : 0 })
      rowHunk.push(id)
    }
  })
  return { hunks, rowHunk }
}

function buildFinalContent(rows, rowHunk, excluded, original, incoming) {
  const totalHunks = rowHunk.reduce((max, h) => Math.max(max, h ?? -1), -1) + 1
  if (totalHunks === 0 || excluded.size >= totalHunks) return original
  const kept = []
  rows.forEach((row, i) => {
    const hunkId = rowHunk[i]
    if (row.type === 'same') { kept.push(row); return }
    const skipped = hunkId !== null && excluded.has(hunkId)
    if (row.type === 'add' && !skipped) kept.push(row)
    else if (row.type === 'del' && skipped) kept.push(row)
  })
  if (kept.length === 0) return original
  let text = kept.map((r) => r.text).join('\n')
  const last = kept[kept.length - 1]
  const endsNL = last.type === 'add' ? incoming.endsWith('\n') : original.endsWith('\n')
  if (endsNL) text += '\n'
  return text
}

const rows = buildRows(original, incoming)
const { hunks, rowHunk } = buildHunks(rows)
console.log('HUNK_COUNT', hunks.length, JSON.stringify(hunks))

// 场景 1：全部应用 → 应等于 incoming
const r1 = buildFinalContent(rows, rowHunk, new Set(), original, incoming)
console.log('S1 全部应用 ===incoming:', r1 === incoming)

// 场景 2：跳过幻影块（末块）→ 前 2 处修改 + 保留原末尾换行
const r2 = buildFinalContent(rows, rowHunk, new Set([hunks.length - 1]), original, incoming)
const expect2 = 'def greet(name):\n    print(f"hello {name}")\n    return True\n\ndef bye():\n    print("bye", "see you")\n    return False\n\n# end\n'
console.log('S2 跳过幻影块 正确:', r2 === expect2)

// 场景 3：全部跳过 → 原样返回
const r3 = buildFinalContent(rows, rowHunk, new Set(hunks.map((h) => h.id)), original, incoming)
console.log('S3 全部跳过 ===original:', r3 === original)

// 场景 4：跳过第 1 块 → 只应用第 2 块（+ 幻影块删除末行换行，符合「应用 incoming 尾部」语义）
const r4 = buildFinalContent(rows, rowHunk, new Set([0]), original, incoming)
const expect4 = 'def greet(name):\n    print("hello " + name)\n    return True\n\ndef bye():\n    print("bye", "see you")\n    return False\n\n# end'
console.log('S4 跳过第1块 正确:', r4 === expect4)

// 场景 5：AI 代码带末尾换行（无幻影块）→ 2 块，全部应用 ===incoming
const incoming5 = 'def greet(name):\n    print(f"hello {name}")\n    return True\n\ndef bye():\n    print("bye", "see you")\n    return False\n\n# end\n'
const rows5 = buildRows(original, incoming5)
const { hunks: hunks5, rowHunk: rh5 } = buildHunks(rows5)
console.log('S5 HUNK_COUNT', hunks5.length)
const r5 = buildFinalContent(rows5, rh5, new Set(), original, incoming5)
console.log('S5 全部应用 ===incoming:', r5 === incoming5)
const r5s = buildFinalContent(rows5, rh5, new Set([0]), original, incoming5)
const expect5s = 'def greet(name):\n    print("hello " + name)\n    return True\n\ndef bye():\n    print("bye", "see you")\n    return False\n\n# end\n'
console.log('S5 跳过第1块 正确:', r5s === expect5s)
