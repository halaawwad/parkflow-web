# Accessible walking navigation

An opt-in mode (**Settings → Voice → Accessible walking navigation**) for walking by ear:

1. Tap the microphone and say a place: "بدي أروح على دوار المنارة", "Take me to Manara Square",
   "Navigate to the nearest parking area".
2. ParkFlow finds it with the normal place search, picks walking, asks the routing engine for
   a foot route and starts the existing turn-by-turn voice guidance. No mode switch needed.
3. Where the device supports it, the rear camera watches the path ahead and speaks short
   obstacle warnings through the same voice, without talking over turn instructions.

It is an **aid only**. It never says the way is clear, never tells anyone to step sideways or
cross, and never gives distances to obstacles. It does not replace a cane, a guide dog or
mobility training. Nothing here has been validated with real walkers yet (see below).

## How it fits together

```
Microphone (DestinationSearchBox, existing recogniser)
  └─ src/utils/navigation/voiceCommand.ts   command words removed; one clear match or ask
       └─ searchPlaces (existing)  →  app/(tabs)/map.tsx startWalkingNavigation
            └─ useTurnByTurnNavigation.start({ profile: 'walking' })   (unchanged engine)
parkflow://map?walkTo=<place>  → same path (Siri Shortcuts, home-screen links)

NavigationOverlay (walking + preference on)
  └─ ObstacleAwarenessPanel → src/hooks/useObstacleAwareness.ts
       ├─ src/utils/obstacles/camera.web.ts  getUserMedia rear camera + MediaPipe detector
       ├─ src/utils/obstacles/engine.ts      tracker → warning policy, reliability
       │    ├─ tracker.ts    confidence ≥ 0.5, ≥ 3 frames, walking corridor, rough nearness
       │    ├─ warnings.ts   cooldowns, phrases, status announcements
       │    └─ quality.ts    dark / covered / blurred / slow / stalled camera
       └─ nav.announce → SpeechQueue: urgent (hazard) > high (turns) > normal (info)
```

The obstacle engine never reads GPS or the route, and the navigation engine never reads the
camera. They meet only in the speech queue.

## Platform support

| | Web (Chrome, Safari, Edge; HTTPS) | Android app | iOS app |
| --- | --- | --- | --- |
| Spoken destination → walking guidance | Yes (browser speech recognition; not in Firefox) | Yes (dev/production build) | Yes (dev/production build) |
| `parkflow://map?walkTo=` link | `https://<site>/map?walkTo=` | Yes | Yes |
| Siri | No | No | Through a Shortcut that opens the link (below). No App Intent yet |
| Camera obstacle alerts | Yes, on-device in the browser | **Not available**: says so and guides without it | **Not available**: says so and guides without it |
| Locked screen / background | Camera and guidance voice stop; the camera restarts and says so on return | Guidance voice stops (existing behaviour) | Guidance voice stops (existing behaviour) |

**Why no native camera alerts:** live inference on iOS/Android needs a frame-processor camera
and an ML runtime in the native build (for example VisionCamera with TensorFlow Lite or Core ML).
`expo-camera` has no frame access. This was not added because it could not be built or tested
here, and an unverified native dependency could break the app. `src/utils/obstacles/camera.ts`
is where a native implementation plugs in; the engine, tracker, warnings and tests are shared.

**Siri today:** in the Shortcuts app, create a shortcut named for example "ParkFlow walk",
add *Ask for Input* (text) and then *Open URLs* with `parkflow://map?walkTo=` followed by the
input. "Hey Siri, ParkFlow walk" then asks for the place. A real App Intent ("Take me to …
using ParkFlow") needs Swift code in a native module and a Mac build.

## Model and privacy

- MediaPipe Tasks Vision `0.10.35`, EfficientDet-Lite0 int8 (COCO), on the **CPU** delegate.
  The GPU delegate loaded without error in headless Chrome and then returned no detections at
  all, so it is not used. Before monitoring starts, the detector must find the person in
  MediaPipe's sample portrait; if not, alerts report that they could not start.
- Smoke test (headless Chrome, desktop CPU, real photos and a fake camera feeding real frames
  through `getUserMedia`): portrait → person 0.98; COCO val2017 #139 → 2 chairs, 2 potted plants,
  but **missed the small person in the background**; about 90–210 ms per frame, model ready in
  about 1.5–2 s. Phones will be slower. This is a single-image check, not an accuracy measurement.
- Classes reported: person, bicycle, motorcycle, car, bus, truck, bench, chair, fire hydrant,
  parking meter, stop sign, potted plant, dog. **Not detected:** poles in general, trees, walls,
  barriers, holes, curbs, stairs or changes in level.
- Frames stay on the device; nothing is recorded, stored or uploaded. The browser downloads the
  WebAssembly runtime (jsDelivr), the 4.6 MB model and the self-test photo (Google Cloud Storage).
- About 2–6 frames a second; slower when the model is slow or the battery is below 20 %.

## Tuning that still needs real-device calibration

All in plain constants: `TRACKING` (tracker.ts), `WARNING_TIMING` (warnings.ts) and
`RELIABILITY` (quality.ts). The corridor, the "close" box sizes and the dark/blur thresholds
are first estimates, not measurements.

## Validation before anyone relies on it

Automated tests (`npm run test:navigation`) cover command parsing, destination choice, the
tracker, warnings, reliability and speech priority on **synthetic** data only. They say nothing
about how well the model sees real obstacles. Still to do, with a sighted spotter on every walk
and never with unsupervised visually impaired participants:

1. **Annotated footage:** record chest-height walks (day, dusk, rain, crowds, parked cars), label
   obstacles in the walking corridor, replay through the detector, and report per class:
   detection rate, false alarms per minute, missed obstacles, warning latency.
2. **Devices:** a mid-range Android phone with Chrome and an iPhone with Safari: model load time,
   inference ms per frame, battery drain per 30 min, heat.
3. **Controlled course:** placed obstacles at known spots; check that close warnings arrive in
   time to stop at walking pace, and that a covered lens or darkness is announced.
4. **Audio:** turn instruction interrupted by a hazard, then repeated; no overlapping speech;
   screen readers (VoiceOver, TalkBack) running at the same time.
5. **Voice commands:** Arabic dialect and English requests for local places, misrecognition
   and ambiguous names.
