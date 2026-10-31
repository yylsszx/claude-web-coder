import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const sid = 'cmvwgqs9o000aq0oqyxfv7nyc'
const msgs = await p.chatMessage.findMany({ where: { sessionId: sid }, orderBy: { createdAt: 'asc' } })
console.log('总数', msgs.length)
const last = msgs.slice(-9)
last.forEach(m => console.log(m.id, m.role, JSON.stringify(m.content.slice(0, 22)), m.createdAt.toISOString()))
await p.$disconnect()
