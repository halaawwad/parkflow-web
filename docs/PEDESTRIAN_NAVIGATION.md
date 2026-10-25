# Walking navigation

ParkFlow navigates on foot as well as by car. Choose **مشي / Walk** in the route panel,
or switch mid-trip from the steps sheet. The route, timing, voice prompts and map all
follow the walking profile. Driving is unchanged.

## How it fits together

Walking reuses the turn-by-turn engine that already guides drivers. Both modes get their
routes from OSRM, which returns the same step format for each, so one engine guides both.

```
Route panel (TravelModeToggle)
  └─ POST /api/v1/routes/plan { profile: 'walking', steps: true }
       └─ server/src/modules/routing/service.ts
            driving → OSRM_BASE_URL       /route/v1/driving
            walking → OSRM_FOOT_BASE_URL  /route/v1/${OSRM_FOOT_PROFILE}
Turn-by-turn (src/hooks/useTurnByTurnNavigation.ts)
  ├─ GPS: expo-location watchPositionAsync (BestForNavigation, 1 s)
  ├─ src/utils/navigation/maneuvers.ts     provider steps → maneuvers (never invented)
  ├─ src/utils/navigation/session.ts       pure state machine: progress, off-route, wrong way,
  │                                        signal loss, arrival, pause, ETA — tuned per profile
  ├─ src/utils/navigation/voiceScheduler.ts which prompt is due, by distance, per profile
  ├─ src/utils/navigation/instructions.ts  Arabic / English wording
  └─ src/utils/navigation/speechQueue.ts   one voice at a time, stale prompts dropped
```

## Routing provider

| | Driving | Walking |
| --- | --- | --- |
| Server | `OSRM_BASE_URL` (default `router.project-osrm.org`) | `OSRM_FOOT_BASE_URL` (default `routing.openstreetmap.de/routed-foot`) |
| Profile | `driving` | `OSRM_FOOT_PROFILE` (default `foot`) |
| Data | OpenStreetMap | OpenStreetMap: footways, crossings, pedestrian streets. One-way rules don't apply; motorways are excluded |
| Destination | Snapped to the nearest drivable road | Used as given |
| Traffic, heading hint | Yes | No |

**Why OSRM's foot profile:** the app already used OSRM for driving, so walking routes arrive
in the same format and need no new parsing. It has good OpenStreetMap coverage in Palestine,
and no API key or per-request cost.

The default walking server is run by FOSSGIS for **fair, non-commercial use**. It works out of
the box, but for production traffic self-host OSRM with the foot profile and set
`OSRM_FOOT_BASE_URL`. Every request identifies itself with `ROUTING_USER_AGENT`, as the
operators ask.

**When no walking route exists:** if the router is unreachable or finds no path, the API
returns `source: 'straight-line'`. The app then says no walking route was found and does not
offer navigation. A straight line is never presented as a route.

## GPS tracking

- **Permission:** asked when navigation starts. If it's denied, the app shows a clear error
  with a retry.
- **Fixes:** every second at best accuracy. Each fix is snapped onto the route only if it is
  within the off-route band; otherwise the raw position is shown.
- **Accuracy:** fixes worse than 35 m (walking) or 40 m (driving) never move guidance. After
  8 s of only poor fixes the signal is "weak". With no fixes for 15 s it is "lost". Guidance
  pauses (the card dims and the voice stops giving turns) and resumes when good fixes return.
  The trip panel shows `±N m` when accuracy is worse than 15 m.
- **Heading:** taken from the platform's course when moving, otherwise from real movement
  between fixes. Wrong-way detection only trusts a heading measured on the current fix.
- **Battery:** tracking stops on pause, arrival, and when navigation ends.

### Walking thresholds (`WALK_NAV` in `session.ts`)

| | Walking | Driving |
| --- | --- | --- |
| Off-route band | 25–50 m (widens with poor accuracy) | 30–60 m |
| Off-route confirmed after | 4 fixes and 8 s | 3 fixes and 5 s |
| Wrong way | ≥ 0.6 m/s against the route, 4 fixes, 10 s | ≥ 2 m/s, 3 fixes, 6 s |
| Arrival radius | 15 m | 25 m |

## Turn-by-turn and voice

Every instruction comes from a step the router returned. Prompts are tied to distance:

| Prompt | Walking | Driving |
| --- | --- | --- |
| Advance ("In 120 meters, turn left") | ~120 m (100–200) | 500–1600 m |
| Prepare ("In 40 meters, …") | ~40 m (30–60) | 120–400 m |
| Now ("Turn left") | ~10 m (8–15) | 25–70 m |
| Chained ("Turn right, then turn left") | next turn within 25 m | within 60 m+ |
| Long stretch | "Continue walking for 300 meters." | "Continue straight for 1.2 kilometers." |

- **Each prompt plays at most once per maneuver.** A late prompt never triggers earlier ones.
- **Walking distances are rounded to 10 m up to 200 m,** so "In 130 meters" is never said as "150".
- **Arabic uses correct number agreement** ("10 أمتار", "50 مترًا", "200 متر").
- **Voice:** spoken by the device's speech engine, or by Gemini's natural voice when
  `GEMINI_API_KEY` is set on the server (prefetched ahead of time; see GEMINI_SETUP.md).
- **Controls:** mute/unmute, repeat the current instruction, and steps list. On web, each
  announcement is also mirrored to a screen-reader live region.

**Walking phrases:**
- start: "Walking navigation started." / "بدأت ملاحة المشي."
- off route: "You are off the route. Calculating a new walking route." / "ابتعدت عن المسار. جاري حساب طريق جديد."
- wrong way: "You seem to be walking the wrong way." / "يبدو أنك تمشي في الاتجاه المعاكس."
- arrival: "You have arrived at your destination, on the left." / "لقد وصلت إلى وجهتك، على يسارك."

## Rerouting

1. A fix more than the off-route band from the route starts counting. Drifted fixes reset the count.
2. After 4 fixes over 8 s (walking), the reroute is confirmed and announced, and a new walking
   route is requested from where the user is.
3. **Requests are rate-limited:**
   - at most one every 10 s, backing off up to 60 s after failures;
   - a newer request supersedes an older one;
   - the server also caps `/routes/plan` at 60 requests per minute per client.
4. **The trip doesn't restart:** guidance continues on the new route, with the same destination,
   voice settings and remaining stops.
5. **When a reroute starts away from the path:** a new route starts at the nearest mapped way,
   which can be tens of metres away (inside a building block, a car park). That gap is tolerated
   until the user reaches the route, so standing still does not reroute again and again.
6. **Offline:** if a reroute fails for lack of connection, guidance continues on the old route,
   the app says it is offline, and it retries with backoff.

## Smart ETA

- **Driving** uses the router's per-step times.
- **Walking** blends the router's estimate with the walker's measured pace while they are
  clearly moving (0.5–3 m/s). Standing at a crossing does not stretch the ETA.

## Map and controls

- **Route line:** walking routes are drawn as round dots, driving routes as a solid line. The walked
  part is muted.
- **Camera:** follows one zoom level closer when walking. On native it is flat rather than tilted.
- **"Full route":** fits the whole remaining path. "Recenter" returns to following.
- **Trip panel:** shows the mode, accuracy (when poor), arrival time, time left and distance left.
- **Controls:** end, pause/resume, repeat, mute/unmute, and steps. The steps sheet holds the
  mode switch and vibration.

## Background behaviour (verified limits)

| Platform | Location while the app is in the background | Voice in the background |
| --- | --- | --- |
| Web (mobile browsers) | Stops when the tab is hidden or the screen locks | No |
| Android / iOS app | Foreground location only (no background location permission is requested) | No: guidance pauses and resumes on return |

The screen is kept awake during navigation. Coming back after more than 10 s re-announces the
current instruction. Shorter interruptions change nothing, and a pause the user chose is never
undone by returning to the app.

Continuous background guidance would need a background location service and audio session.
It is **not** implemented. See `docs/crash-detection.md` for the one feature that does run in
the background (Android only).

## API

`POST /api/v1/routes/plan` (authenticated)

```json
{ "origin": {"latitude": 31.9038, "longitude": 35.2044},
  "destination": {"latitude": 31.9006, "longitude": 35.2087},
  "profile": "walking", "mode": "fastest", "steps": true, "maxAlternatives": 2 }
```

The response includes `profile`, `source` (`osrm` or `straight-line`), `distanceMeters`,
`durationSeconds`, `coordinates`, `steps[]` (OSRM maneuvers) and `alternatives[]`.

`POST /api/v1/routes/summary` is the optional AI overview; see GEMINI_SETUP.md.

## Privacy

- **Location travels only in request bodies,** which the server logger redacts.
- **Routes are cached in memory for 60 s** (the AI overview for 1 h) and are not stored.
- **No GPS history is kept**, on the device or on the server.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| "No walking route was found" | `curl "$OSRM_FOOT_BASE_URL/route/v1/foot/35.2044,31.9038;35.2087,31.9006?overview=false"` from the server should return `"code":"Ok"` |
| Walking route identical to driving | The server is older than this change, or `profile` isn't being sent. The route response should include `"profile":"walking"` |
| Guidance card dimmed | Weak or lost GPS. Move to open sky; the trip panel shows accuracy |
| Repeated reroutes | Check GPS accuracy. Each request is at least 10 s apart; a stationary user away from the path is not rerouted again |
| No voice on web | Browsers block audio until the user interacts. Tap the banner or "Repeat" |
