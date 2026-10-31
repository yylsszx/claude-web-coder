-- v0.19.0 手动迁移：会话置顶/固定（pinned 置顶的会话在会话列表中优先展示）
ALTER TABLE "ChatSession" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT 0;
