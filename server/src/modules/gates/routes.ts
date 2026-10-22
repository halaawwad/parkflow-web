import multer from 'multer';
import { z } from 'zod';
import type { Request } from 'express';
import { api, id, route, text, user } from '../../apiRegistry';
import { auth, roles } from '../../middleware/auth';
import type { NextFunction, Response } from 'express';
import { ApiError } from '../../utils/errors';
import * as gates from './service';
import * as automatic from './automation';

const staff = (r: Request): gates.Staff => ({ userId: r.auth!.userId, role: r.auth!.role });
const gateStaff = ['ADMIN', 'PARKING_OPERATOR'] as const;
const patrolStaff = ['ADMIN', 'PARKING_OPERATOR', 'ENFORCEMENT_OFFICER'] as const;
const plate = z.string().trim().min(4).max(20);
const scan = z.object({ zoneId: id, plate: plate.optional(), pass: z.string().trim().min(20).max(2000).optional() })
  .strict().refine((b) => Boolean(b.plate) !== Boolean(b.pass), 'Send either a plate or a gate pass');

// Driver: the rotating QR shown at a QR gate.
route('get', '/gate-pass', z.object({ vehicleId: id }).strict(), (r, b) => gates.gatePass(user(r), b.vehicleId));

// Gate mode (operators): scan a driver's pass or type a plate.
route('get', '/gate/zones', z.object({}).strict(), (r) => gates.zones(staff(r)), [...patrolStaff]);
route('get', '/gate/zones/:id/visits', z.object({}).strict(), (r) => gates.visits(staff(r), String(r.params.id)), [...gateStaff]);
route('post', '/gate/entry', scan, (r, b) => gates.staffEnter(staff(r), b), [...gateStaff]);
route('post', '/gate/exit', scan, (r, b) => gates.staffExit(staff(r), b), [...gateStaff]);
route('get', '/gate/zones/:id/occupancy', z.object({}).strict(), (r) => gates.occupancy(staff(r), String(r.params.id)), [...gateStaff]);

// SmartGate: a camera frame is read by the pretrained ALPR service, then the operator confirms entry or exit.
const frame = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1, fieldSize: 200, parts: 2 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
}).single('image');
/** Runs the handler with the uploaded camera frame; the frame lives only for this request. */
const withFrame = <T extends z.ZodType>(fields: T, handler: (req: Request, body: z.output<T>, image: Express.Multer.File) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => frame(req, res, async (error) => {
    try {
      if (error) throw new ApiError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'ALPR_INVALID_IMAGE', 'Send one JPEG, PNG or WebP image up to 8 MB');
      const body = fields.parse(req.body ?? {});
      if (!req.file?.size) throw new ApiError(400, 'ALPR_INVALID_IMAGE', 'Send one JPEG, PNG or WebP image up to 8 MB');
      res.json(await handler(req, body, req.file));
    } catch (e) { next(e); }
    finally { delete req.file; }
  });
// Manual fallback: read one photo and let the operator confirm.
api.post('/gate/recognize', auth, roles([...gateStaff]), withFrame(z.object({ zoneId: id }).strict(), (r, b, image) => gates.recognize(staff(r), b.zoneId, image)));

// Automatic cameras: frames in, entries and exits out, no operator needed.
route('post', '/gate/zones/:id/stations', z.object({ direction: z.enum(['entry', 'exit']) }).strict(),
  (r, b) => automatic.station(staff(r), String(r.params.id), b.direction), [...gateStaff]);
api.post('/gate/devices/:id/frames', auth, roles([...gateStaff]), withFrame(z.object({}).strict(), (r, _b, image) => automatic.staffFrame(staff(r), String(r.params.id), image)));
// Hardware cameras authenticate with their device key; the direction is fixed on the device.
api.post('/gate/camera-frames', withFrame(z.object({}).strict(), (r, _b, image) => automatic.keyedFrame(r.get('X-Gate-Key') ?? '', image)));
route('get', '/gate/zones/:id/live', z.object({}).strict(), (r) => automatic.liveView(staff(r), String(r.params.id)), [...gateStaff]);
route('post', '/gate/events/:id/reviewed', z.object({}).strict(), (r) => automatic.markReviewed(staff(r), String(r.params.id)), [...gateStaff]);
route('get', '/gate/lookup', z.object({ zoneId: id, plate }).strict(), (r, b) => gates.lookup(staff(r), b.zoneId, b.plate), [...gateStaff]);

route('patch', '/gate/zones/:id/rules', z.object({
  overstayGraceMinutes: z.number().int().min(0).max(240),
  overstayFee: z.number().int().min(0).max(100000),
  overstayRepeatMinutes: z.number().int().min(15).max(1440),
  overstayMaxPerStay: z.number().int().min(0).max(1000000),
}).strict(), (r, b) => gates.rules(staff(r), String(r.params.id), b), [...gateStaff]);
route('post', '/gate/zones/:id/devices', z.object({ name: text, kind: z.enum(['camera', 'qr_scanner']), direction: z.enum(['entry', 'exit']).optional() }).strict(),
  (r, b) => gates.createDevice(staff(r), String(r.params.id), b), [...gateStaff]);

// Plate cameras: no user session, the device key in X-Gate-Key identifies the lot.
route('post', '/gate/camera-events', z.object({ plate, direction: z.enum(['entry', 'exit']), at: z.iso.datetime({ offset: true }).optional() }).strict(),
  (r, b) => gates.cameraEvent(r.get('X-Gate-Key') ?? '', b), false);

// Officer patrol.
route('get', '/enforcement/check', z.object({ zoneId: id, plate }).strict(), (r, b) => gates.patrolCheck(staff(r), b.zoneId, b.plate), [...patrolStaff]);
route('post', '/enforcement/violations', z.object({ zoneId: id, plate }).strict(), (r, b) => gates.patrolIssue(staff(r), b.zoneId, b.plate), [...patrolStaff]);
