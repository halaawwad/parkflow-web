# Testing walking navigation

There are three levels of testing. Only the third proves real-world behaviour.

1. **Automated engine tests:** real routes from the walking router, driven by **simulated** GPS.
2. **Browser verification:** the real app against the real backend and router, with **simulated**
   GPS injected into the browser.
3. **Real-device walks:** a phone, outdoors. **Not yet done**; checklist below.

## 1. Automated tests

```bash
npm run test:navigation      # engine: maneuvers, session, voice, prefetch, walking
npm run test:notifications
npm run test:network
cd server && npm test        # API, routing profiles, Gemini client, everything else
```

`tests/navigation/fixtures/ramallah-walk-*.json` are real responses from the OSRM foot profile
(routing.openstreetmap.de), recorded for these tests. `tests/navigation/walking.test.ts` covers:

| Area | What is asserted |
| --- | --- |
| Routes | Steps become maneuvers 1:1, kinds and arrival side match the provider, nothing is invented |
| Thresholds | Walking off-route band and arrival radius are tighter than driving, and more patient |
| Voice timing | ~120 / 40 / 10 m windows, every turn gets one "now" prompt within 16 m of the corner, no duplicates, spoken distance within 10 m of the truth |
| Wording | Arabic and English walking phrases, including the exact reroute sentence |
| Full walk | Simulated walk with ±4 m GPS noise along a 17-turn route, from start to arrival |
| Rerouting | Brief drift is ignored; a sustained 40 m detour triggers a reroute and the trip continues to arrival |
| Wrong way | Walking backwards at 1.4 m/s is caught in walking mode (driving thresholds would miss it); a standing user with an old heading is not flagged |
| Start gap | A user standing 35 m from where a new route begins is not rerouted again and again; the normal band applies once they reach the route |
| App return | Blips under 10 s change nothing; a user's pause is never undone |
| Arrival | Within 15 m arrives; 22 m out does not |
| Pause / signal | Fixes are ignored while paused; lost signal suspends guidance and keeps the route |
| ETA | Follows the walker's measured pace while moving, the router's while standing; driving unchanged |

`tests/navigation/voicePrefetch.test.ts` runs every route at speeds its mode actually travels:
1–2.5 m/s for walking, 6–14 m/s for driving. It checks that every spoken sentence was fetched
before it was needed.

`server/tests/walking.test.ts` checks:
- requests go to the foot-profile server with `User-Agent` set, and car-only steps are skipped;
- driving and walking are cached separately;
- the offline fallback is not navigable;
- the Gemini key is sent only as a header, rate limits are retried, and errors never contain the key;
- ungrounded summaries are dropped;
- API validation and authentication.

## 2. Browser verification (done for this release)

The real app (Expo web) ran against the local Docker backend and the live FOSSGIS foot router.
The browser's geolocation was replaced by a scripted track along the route geometry the server
returned, so these are **simulated** positions.

**What was checked:**
- **Mode switch:** switching to walking re-planned the route (640 m by car vs 580 m on foot, with different turns) and drew it dotted.
- **Start:** the button read "ابدأ ملاحة المشي", and starting said "بدأت ملاحة المشي".
- **Prompts:** each turn got one advance prompt, one prepare prompt and one "now" prompt, in Arabic, with correct left/right.
- **Detour:** a 45 m detour gave exactly one "ابتعدت عن المسار. جاري حساب طريق جديد.", a new 373 m walking route, and no repeats while standing still for 25 s.
- **Arrival:** walking the new route gave "لقد وصلت إلى وجهتك، على يسارك" and the arrival panel, and GPS watchers dropped to 0.
- **Controls:** pause/resume, mute, repeat, full route, recenter, end, and switching to driving mid-trip.
- **Display:** English LTR, dark mode, and the accuracy chip at ±24 m.
- **Driving regression:** solid line and unchanged guidance.

**Defects found this way and fixed (each now has a test):**
- **Repeated prompts:** prompts were replayed after app-visibility blips.
- **Blocked reroutes:** off-route evidence was reset by those blips, so a reroute could never be confirmed.
- **Pause undone:** a user pause was lifted on returning to the app.
- **Reroute loop:** a stationary user away from the path was rerouted repeatedly.
- **False wrong way:** a stale heading triggered "wrong way" while standing still.
- **Accessibility:** the mode toggle exposed no checked state on web.

## 3. Real-device checklist (outstanding)

These need a phone outdoors. **Until they are done, real-world behaviour is unverified.**

Android: a development build (`npx expo run:android`) or Chrome on the web build. iPhone:
Safari on the web build (no native iOS build is configured in this repo).

| # | Check | Android | iPhone Safari |
| --- | --- | --- | --- |
| 1 | Location permission prompt appears on Start; denying shows the error with retry | ☐ | ☐ |
| 2 | Blue arrow follows you within a few metres; turning your body updates direction once you walk | ☐ | ☐ |
| 3 | "In ~120 m" / "In ~40 m" / "Turn now" are heard at the right corners, not early or late | ☐ | ☐ |
| 4 | A chained turn ("…, then turn left") is spoken when two corners are close | ☐ | ☐ |
| 5 | Taking a wrong street: reroute is announced within ~10 s, once, and the new route is sensible | ☐ | ☐ |
| 6 | Walking back the way you came is flagged as wrong way; standing still is not | ☐ | ☐ |
| 7 | Arrival is announced at the entrance, on the correct side | ☐ | ☐ |
| 8 | ETA tracks your pace (slow down / speed up for a minute) | ☐ | ☐ |
| 9 | Under trees or between tall buildings: accuracy chip appears; card dims rather than giving wrong turns | ☐ | ☐ |
| 10 | Airplane mode mid-route: offline notice, guidance continues; reconnecting resumes | ☐ | ☐ |
| 11 | Lock the screen for 30 s and unlock: current instruction is repeated once; a manual pause stays paused | ☐ | ☐ |
| 12 | Voice in Arabic and English is clear; mute, repeat and switching language work | ☐ | ☐ |
| 13 | Gemini natural voice (if `GEMINI_API_KEY` set) plays without gaps | ☐ | ☐ |
| 14 | Battery use over a 20-minute walk is acceptable | ☐ | ☐ |
| 15 | Driving navigation still behaves as before | ☐ | ☐ |

**Known platform limits** (see PEDESTRIAN_NAVIGATION.md): guidance does not continue with the
screen locked or the app in the background, on any platform.
