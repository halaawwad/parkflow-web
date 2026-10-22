-- SmartGate: a driver's consent to start and bill pay-as-you-go parking when a gate camera reads their plate.
-- AlterTable
ALTER TABLE "user_vehicles" ADD COLUMN     "autoGateParking" BOOLEAN NOT NULL DEFAULT false;
