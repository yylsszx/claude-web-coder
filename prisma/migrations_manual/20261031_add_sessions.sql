-- v0.3.0 手动迁移：新增 ChatSession 表并把现有消息归入默认会话（保留历史数据）
CREATE TABLE IF NOT EXISTS "ChatSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL DEFAULT '新会话',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "ChatMessage" ADD COLUMN "sessionId" TEXT;

INSERT INTO "ChatSession" ("id", "title", "updatedAt")
VALUES ('cdefaultsession0000000000', '默认会话', CURRENT_TIMESTAMP);

UPDATE "ChatMessage" SET "sessionId" = 'cdefaultsession0000000000' WHERE "sessionId" IS NULL;

CREATE INDEX IF NOT EXISTS "ChatMessage_sessionId_idx" ON "ChatMessage"("sessionId");
