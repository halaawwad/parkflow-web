-- SmartGate automatic cameras: camera direction and live status, plus an event log. Additive only.
-- AlterTable
ALTER TABLE "gate_devices" ADD COLUMN     "direction" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastErrorAt" TIMESTAMP(3),
ADD COLUMN     "lastPlate" TEXT;

-- CreateTable
CREATE TABLE "gate_events" (
    "id" TEXT NOT NULL,
    "parkingZoneId" TEXT NOT NULL,
    "deviceId" TEXT,
    "direction" TEXT NOT NULL,
    "plateNumber" TEXT,
    "reading" TEXT,
    "outcome" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "frames" INTEGER NOT NULL DEFAULT 0,
    "visitId" TEXT,
    "message" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gate_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gate_events_parkingZoneId_createdAt_idx" ON "gate_events"("parkingZoneId", "createdAt");

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_parkingZoneId_fkey" FOREIGN KEY ("parkingZoneId") REFERENCES "parking_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "gate_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
