import type { RoadService } from './types';
import type { CheckpointState, ZoneReport } from '@/types';
import { AppError } from '@/utils/errors';
import { createId } from '@/utils/id';
import { networkDelay } from '@/utils/async';
import { nowIso } from '@/utils/time';
import { ZONES } from './mock/catalog';
import { CHECKPOINTS } from './mock/roads';
import { getDb, mutate, type MockDatabase } from './mock/db';
import { awardReportPoints } from './mock/points';
import { needsZoneSeed, seedZoneReports } from './mock/community';

/** Legacy offline catalog has no administrator-reviewed travel directions.
 * It must never manufacture live checkpoint evidence. Production uses HTTP. */
export function computeCheckpointStates(_db: MockDatabase): CheckpointState[] {
  return CHECKPOINTS.map(checkpoint=>({...checkpoint,status:'unknown',assumed:true,reportCount:0,enabledForLiveReporting:false,directions:[]}));
}
export async function loadCheckpointStates(): Promise<CheckpointState[]> {
  return computeCheckpointStates(await getDb());
}

export const mockRoadService: RoadService = {
  async confirm() { throw new AppError('validation','Live checkpoint reporting requires the server'); },
  async listCheckpoints() {
    await networkDelay(120, 260);
    return loadCheckpointStates();
  },

  async feed() { return []; },
  async report() { throw new AppError('validation','Live checkpoint reporting requires the server'); },

  async reportZone({ userId, zoneId, availability }) {
    await networkDelay();
    if (!ZONES.some((z) => z.id === zoneId)) throw new AppError('not_found', 'Parking zone not found');

    return mutate((db) => {
      if (needsZoneSeed(db)) seedZoneReports(db);
      const report: ZoneReport = {
        id: createId('zrp'),
        zoneId,
        userId,
        availability,
        reportedAt: nowIso(),
      };
      db.zoneReports.push(report);
      const points = awardReportPoints(db, {
        userId,
        reason: 'zone_report',
        placeId: zoneId,
        refId: report.id,
      });
      return { report, points };
    });
  },
};
