import { z } from 'zod';
import { route, empty, actor, param } from '../../apiRegistry';
import * as operator from './service';

// All routes authenticate through the existing flow. Membership, not a global
// role change, decides staff access; every request rechecks current grants.
route('get','/operator/access',empty,r=>operator.access(actor(r)));
route('get','/operator/zones',empty,r=>operator.zones(actor(r)));
route('get','/operator/analytics',z.object({days:z.coerce.number().int().min(1).max(90).default(30),zoneId:z.string().min(1).max(200).optional()}).strict(),(r,b)=>operator.analytics(actor(r),b.days,b.zoneId));
route('get','/operator/organizations',empty,r=>operator.organizations(actor(r)));
route('get','/operator/organizations/:id/staff',empty,r=>operator.staff(actor(r),param(r)));
const permissions={canViewAnalytics:z.boolean(),canUpdateAvailability:z.boolean()};
route('post','/operator/organizations/:id/staff',z.object({email:z.string().trim().toLowerCase().pipe(z.email().max(254)),...permissions}).strict(),(r,b)=>operator.addStaff(actor(r),param(r),b));
route('patch','/operator/organizations/:id/staff/:userId',z.object(permissions).strict(),(r,b)=>operator.updateStaff(actor(r),param(r),param(r,'userId'),b));
route('delete','/operator/organizations/:id/staff/:userId',empty,r=>operator.removeStaff(actor(r),param(r),param(r,'userId')));
route('post','/operator/zones/:id/availability',z.object({availability:z.enum(['available','limited','full','unknown']),confidence:z.number().min(0).max(1),availableSpaces:z.number().int().nonnegative().optional(),occupiedSpaces:z.number().int().nonnegative().optional()}).strict(),(r,b)=>operator.availability(actor(r),param(r),b));
