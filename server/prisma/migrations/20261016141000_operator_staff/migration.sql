-- Additive only: existing users, owner memberships and parking data are unchanged.
CREATE TABLE "operator_staff" (
  "operatorId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "canViewAnalytics" BOOLEAN NOT NULL DEFAULT false,
  "canUpdateAvailability" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "operator_staff_pkey" PRIMARY KEY ("operatorId", "userId")
);
CREATE INDEX "operator_staff_userId_idx" ON "operator_staff"("userId");
ALTER TABLE "operator_staff" ADD CONSTRAINT "operator_staff_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "parking_operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operator_staff" ADD CONSTRAINT "operator_staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
