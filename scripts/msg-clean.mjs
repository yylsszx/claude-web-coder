import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const sid = 'cmvwgqs9o000aq0oqyxfv7nyc'
// 删除 HTTP 演示消息之后的全部测试消息（甲乙丙丁 4 对）
const res = await p.chatMessage.deleteMany({
  where: { sessionId: sid, createdAt: { gt: new Date('2026-10-31T14:00:00Z') } },
})
console.log('已删除', res.count, '条测试消息')
const remain = await p.chatMessage.count({ where: { sessionId: sid } })
console.log('剩余', remain, '条')
await p.$disconnect()
