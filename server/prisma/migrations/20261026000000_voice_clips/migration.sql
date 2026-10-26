-- Navigation voice clips, shared by every driver. Pure cache: safe to empty.
CREATE TABLE "voice_clips" (
    "key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "audio" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_clips_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "voice_clips_usedAt_idx" ON "voice_clips"("usedAt");
