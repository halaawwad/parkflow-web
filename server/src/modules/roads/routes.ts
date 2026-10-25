import * as live from './live';
import { z } from 'zod';
import { api,route,empty,id,text,money,geo,limit,admins,operators,officers,user,param,actor,key } from '../../apiRegistry';
import * as authentication from '../../modules/auth/service';
import * as users from '../../modules/users/service';
import * as vehicles from '../../modules/vehicles/service';
import * as parking from '../../modules/parking/service';
import * as sessions from '../../modules/sessions/service';
import * as wallet from '../../modules/wallet/service';
import * as roads from '../../modules/roads/service';
import * as trust from '../../modules/trust/service';
import * as violations from '../../modules/violations/service';
import * as notifications from '../../modules/notifications/service';
import * as admin from '../../modules/admin/service';
import { routingService } from '../../modules/routing/service';
import { summarizeRoute } from '../../modules/routing/summary';
route('get','/roads/checkpoints',empty,()=>roads.checkpoints());
route('get','/roads/reports',z.object({limit}).strict(),(_r,b)=>roads.feed(b.limit));
const observation=z.object({directionId:id,observedAt:z.iso.datetime(),note:z.string().trim().max(200).optional(),unverified:z.boolean(),location:geo.extend({accuracy:z.number().min(0).max(100000),capturedAt:z.iso.datetime()}).strict().optional()});
route('post','/roads/checkpoints/:id/reports',observation.extend({status:z.enum(['open','congested','severe','closed'])}).strict(),(r,b)=>roads.reportRoad(user(r),param(r),b.status,b));
route('post','/roads/checkpoints/:id/confirmations',observation.omit({note:true}).extend({reportId:id}).strict(),(r,b)=>live.observe(user(r),param(r),b,b.reportId));
route('post','/parking/zones/:id/reports',z.object({availability:z.enum(['available','limited','full'])}).strict(),(r,b)=>roads.reportZone(user(r),param(r),b.availability));
route('get','/parking/zones/:id/reports',empty,r=>roads.zoneReports(param(r)));
route(
  'post',
  '/routes/plan',
  z.object({
    origin: geo,
    destination: geo,
    profile: z.enum(['driving', 'walking']).optional(),
    mode: z.enum(['checkpoint-aware', 'fastest']).optional(),
    snapDestination: z.boolean().optional(),
    maxAlternatives: z.number().int().min(0).max(2).optional(),
    steps: z.boolean().optional(),
    originBearing: z.number().min(0).max(360).optional(),
    via: z.array(geo).max(5).optional(),
  }).strict(),
  (_r, b) => routingService.getRoute(b.origin, b.destination, b),
);
// Optional AI overview of a planned route. The client sends the provider's own instructions; nothing is routed here.
route(
  'post',
  '/routes/summary',
  z.object({
    profile: z.enum(['driving', 'walking']),
    locale: z.enum(['ar', 'en']),
    destinationName: z.string().trim().min(1).max(120),
    distanceMeters: z.number().min(0).max(500_000),
    durationSeconds: z.number().min(0).max(200_000),
    steps: z.array(z.object({ instruction: z.string().trim().min(1).max(160), distanceMeters: z.number().min(0).max(500_000) }).strict()).min(1).max(60),
  }).strict(),
  (_r, b) => summarizeRoute(b),
);
route('get','/trust/me',empty,r=>trust.computeTrust(user(r)));
route('get','/points/me',empty,async r=>(await trust.computeTrust(user(r))).recent);
