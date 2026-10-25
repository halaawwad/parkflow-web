-- Additive: existing coordinates and history are preserved. All sites require review.
ALTER TYPE "CheckpointStatus" ADD VALUE 'severe';
ALTER TABLE "road_checkpoints"
 ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'checkpoint',
 ADD COLUMN "sourceReferences" JSONB NOT NULL DEFAULT '[]',
 ADD COLUMN "enabledForLiveReporting" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "directions" JSONB NOT NULL DEFAULT '[]',
 ADD COLUMN "reviewedAt" TIMESTAMP(3), ADD COLUMN "reviewedBy" TEXT,
 ADD COLUMN "nextExpiryAt" TIMESTAMP(3);
ALTER TABLE "road_reports"
 ADD COLUMN "directionId" TEXT, ADD COLUMN "observedAt" TIMESTAMP(3),
 ADD COLUMN "note" TEXT, ADD COLUMN "locationVerified" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "parentId" TEXT;
UPDATE "road_reports" SET "observedAt" = "reportedAt";
ALTER TABLE "road_reports" ALTER COLUMN "observedAt" SET NOT NULL,
 ALTER COLUMN "observedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "road_reports" ADD CONSTRAINT "road_reports_parentId_fkey"
 FOREIGN KEY ("parentId") REFERENCES "road_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "road_reports_parentId_userId_key" ON "road_reports"("parentId", "userId");
CREATE INDEX "road_reports_checkpointId_directionId_observedAt_idx" ON "road_reports"("checkpointId", "directionId", "observedAt");
