// Refresh only clearly marked demo observations; never rewrite real observations.
require('dotenv/config');
const { randomInt, randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Checkpoint demo data is only allowed in development');
  }
  const freshnessMinutes = Number(process.env.CHECKPOINT_FRESHNESS_MINUTES || 20);
  if (!Number.isFinite(freshnessMinutes) || freshnessMinutes < 1 || freshnessMinutes > 120) {
    throw new Error('Invalid checkpoint freshness window');
  }
  const result = await db.$transaction(async tx => {
    const user = await tx.user.upsert({
      where: { email: 'checkpoint-demo@parkflow.local' },
      create: { email: 'checkpoint-demo@parkflow.local', fullName: 'Demo checkpoint data', emailVerifiedAt: new Date() },
      update: {},
    });
    const checkpoints = await tx.roadCheckpoint.findMany({ where: { active: true, enabledForLiveReporting: true } });
    const now = new Date();
    const cutoff = new Date(now.getTime() - freshnessMinutes * 60_000);
    const statuses = ['open', 'congested', 'severe', 'closed'];
    let refreshed = 0, skippedReal = 0;
    for (const cp of checkpoints) {
      for (const directionId of ['entrance', 'exit']) {
        const real = await tx.checkpointReport.findFirst({ where: {
          checkpointId: cp.id, directionId, hidden: false, userId: { not: user.id },
          observedAt: { gt: cutoff, ...(cp.reviewedAt ? { gte: cp.reviewedAt } : {}) },
          OR: [{ parentId: null }, { parent: { hidden: false } }],
        } });
        if (real) { skippedReal++; continue; }
        const id = `demo-checkpoint-${randomUUID()}`;
        const data = {
          status: statuses[randomInt(statuses.length)], observedAt: now, reportedAt: now,
          note: null, locationVerified: false, hidden: false,
        };
        // Preserve real observations and confirmations; hide only this account's older samples.
        await tx.checkpointReport.updateMany({ where: {
          userId: user.id, checkpointId: cp.id, directionId, parentId: null,
        }, data: { hidden: true } });
        await tx.checkpointReport.create({ data: { id, userId: user.id, checkpointId: cp.id, directionId, ...data } });
        refreshed++;
      }
      const expiry = new Date(now.getTime() + freshnessMinutes * 60_000);
      await tx.roadCheckpoint.update({ where: { id: cp.id }, data: {
        nextExpiryAt: cp.nextExpiryAt && cp.nextExpiryAt > now && cp.nextExpiryAt < expiry ? cp.nextExpiryAt : expiry,
      } });
      await tx.outboxEvent.create({ data: { topic: 'checkpoint.updated', payload: { checkpointId: cp.id } } });
    }
    return { checkpoints: checkpoints.length, demoReports: refreshed, skippedReal, freshnessMinutes };
  }, { timeout: 30000 });
  console.log(JSON.stringify(result));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
