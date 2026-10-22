# SmartGate

SmartGate runs unattended. A laptop or phone at the gate, or a hardware camera, works
as the lot's **entry camera** or **exit camera**. It watches continuously, and plates
it reads reliably are entered or exited automatically. Occupancy, notifications and
parking sessions then update by themselves. The owner only watches the live
dashboard; nothing needs to be confirmed in normal operation.

**Any plate can enter.** A car that is not in ParkFlow gets a visit under its plate
number and counts toward occupancy like any other car. It needs no account, and it is
never charged.

## Pieces

| Part | Where |
| --- | --- |
| Plate reader (pretrained FastALPR models, no training) | `server/alpr/` (Python service) |
| Automatic decisions, cameras, event log | `server/src/modules/gates/automation.ts` |
| Entry / exit, occupancy, sessions (existing) | `server/src/modules/gates/service.ts` |
| Owner screen | Management → **SmartGate** (`app/management/smartgate.tsx`) |
| Driver consent for automatic parking | Vehicle details → *SmartGate automatic parking* |

## How a car is processed

1. **Each frame is read on its own.** Only digits are read, and a reading counts only
   if it is complete: 6–8 digits, the whole plate in view, close enough, and every
   digit confident (`server/alpr/README.md`).
2. **Frames must agree.** A plate is accepted only when **3 distinct frames** from
   the same camera read the same complete number within 8 seconds. Any other complete
   reading in that window must be clearly outvoted, and the agreeing frames must be
   confident (mean ≥ 0.85). Sending the same image again does not count twice. These
   decisions are made on the server, so a refreshed page or a second tab cannot
   change them.
3. **The camera's direction decides entry or exit.**
   - **Entry camera:** opens a visit. If the car is already inside, nothing changes
     (`already_inside`).
   - **Exit camera:** closes the open visit.
     - Exit for a car with no recorded entry: nothing changes, flagged for review
       (`not_inside`).
     - Exit within 60 s of entering: not trusted, flagged for review (`too_soon`).
   - Seeing a plate again never becomes an exit; exits only come from an exit camera.
4. **Once per car.** After an event, the same plate at the same camera direction is
   ignored for 90 s, and that timer restarts every time the car is still seen. A car
   that stays in view is processed once.
5. **Uncertain plates don't block anything.** A plate in view for 6 frames without an
   accepted reading is flagged once for review, and the camera keeps scanning for the
   next car. Cars still approaching (too small) or half in view (cut off) are never
   flagged.

What an accepted entry or exit does is unchanged:
- **Registered car:** with the driver's consent, pay-as-you-go parking starts at
  entry, and at exit it is stopped and charged to the wallet. Without consent, the
  driver is notified.
- **Occupancy:** updates, and so does the lot's status on the public map.
- **Unregistered car:** counted and listed, never charged.

### Why repeats, disconnects and network errors cannot double-count or double-bill

- **One frame at a time per camera:** a second frame that arrives while one is still
  being read is dropped (`busy`).
- **Failed frames record nothing:** a frame that fails (recognition offline, network
  error, camera disconnected) never reaches the decision. The camera shows the error
  and retries with growing pauses.
- **Only one acceptance per car:** each plate and direction can be accepted once at a
  time, so racing cameras or retries produce a single event.
- **The database checks again:** entry is idempotent for a car already inside, exit
  needs an open visit, and parking sessions start and stop with idempotency keys. A
  car can therefore only be charged once per visit.

## The owner's screen

- **Automatic camera.** Choose *Entry camera* or *Exit camera* on the device at that
  gate. It then:
  - starts by itself and asks the browser for 1080p;
  - keeps the screen awake and reopens a lost camera by itself;
  - shows what it sees: watching, reading a plate (frames agreeing so far), the last
    plate, the last event, and any errors.
- **Cameras.** Each camera's online status, last plate and last error.
- **Camera events.** Every entry and exit.
- **To review.** Unclear plates, exits without an entry, exits too soon after entry,
  and errors. None of them changed occupancy or billing, and *Mark reviewed* is
  optional.
- **Manual entry (fallback).** Collapsed by default: type a plate or use a photo, then
  confirm by hand. It's only needed when a plate can't be read.

## Hardware cameras

Create a camera with a fixed direction, keep the returned key, and have the camera
or a small relay script post JPEG frames:

```
POST /api/v1/gate/zones/{zoneId}/devices    {"name":"North gate","kind":"camera","direction":"entry"}
POST /api/v1/gate/camera-frames             X-Gate-Key: <key>   multipart field "image"
```

A camera created without a direction cannot send frames for automatic processing.
The older `/gate/camera-events` endpoint, for cameras that read plates themselves,
is unchanged.

## Run it

1. In `server/`, run `npm run db:migrate` and `npm run db:generate`. This adds the
   SmartGate tables and columns; it only adds, nothing is changed or removed.
2. Start the plate reader, as described in `server/alpr/README.md`.
3. Sign in as the lot's owner. Open **Management → SmartGate**, pick the lot, and set
   its capacity under *My parking* if it's empty.
4. On each gate's laptop or phone, open SmartGate, choose *Entry camera* or *Exit
   camera*, and aim it at the lane where plates pass at a car length or less.

The browser camera needs `localhost` or HTTPS.
