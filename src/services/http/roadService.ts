import type { RoadService } from '../types';
import { api,query,segment } from './apiClient';
export const httpRoadService:RoadService={
 listCheckpoints:signal=>api('/roads/checkpoints',{signal}),
 feed:limit=>api('/roads/reports'+query({limit})),
 report:({checkpointId,userId,...body})=>api(`/roads/checkpoints/${segment(checkpointId)}/reports`,{method:'POST',body}),
 confirm:({checkpointId,...body})=>api(`/roads/checkpoints/${segment(checkpointId)}/confirmations`,{method:'POST',body}),
 reportZone:({zoneId,availability})=>api(`/parking/zones/${segment(zoneId)}/reports`,{method:'POST',body:{availability}}),
};
