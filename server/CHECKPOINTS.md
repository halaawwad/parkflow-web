# Community checkpoint status

This extends RoadCheckpoint/CheckpointReport, the authenticated roads API, existing map markers, management report reviews, Socket.IO/Redis, transaction outbox and maintenance worker. No new dependencies or external status providers.

## Setup (explicit operator actions; not performed by this change)

From `server/`, with the existing DATABASE_URL/REDIS_URL environment configured:

```
npm run db:generate
npm run db:migrate
npm run checkpoints:import -- ../ramallah_checkpoints.json
```

Run the existing API and worker services. `CHECKPOINT_FRESHNESS_MINUTES=20` and `CHECKPOINT_RADIUS_METERS=1500` are validated server settings in `.env.example`. No new credentials. The additive migration preserves coordinates and reports, backfills observedAt from reportedAt for history only, and leaves every existing site disabled for live reporting until reviewed. Historical reports have no verified direction and are excluded from live evidence.

The attached schemaVersion 1 file has 18 candidates in `checkpoints` and two separate `missingLocations` records. Names, `type` (`checkpoint` vs `road_gate`), coordinates, `source`, retrievedAt, empty directions and disabled flags were inspected. Import skips null coordinates and the missing-location collection; it never reads historical descriptions as status. Nothing imports on startup, seed or migration.

Import is repeatable: reuse ID, saved source identity, known existing catalog aliases (Qalandiya/Atara/Beit El DCO), or exact normalized names within the same kind. Ambiguous matches or uncertain nearby identities are logged and skipped for manual review. Existing coordinates, names, directions, kind and activation are untouched; only missing source references are appended, including the candidate coordinates for comparison. New records are discoverable map candidates but **inactive for reporting**, with empty directions and unknown status. The original dataset remains unchanged. Run this command serially; if a concurrent administrative write causes a serialization failure, rerun it safely.

In Management > road report reviews, expand a checkpoint candidate, compare source references and current coordinates, enter actual verified travel approaches (stable ID | Arabic label | English label, one per line), explicitly acknowledge coordinate/current presence review, then Save and activate. No directions are inferred. A changed direction needs a new ID. Review/activation records the administrator and audit history. Subsequent review excludes observations predating that review. Reporting can also be disabled here. Checkpoints and road gates retain separate kinds; missing coordinates never create records or markers.

## Deterministic evidence rules

- Each direction is independent. Evidence is fresh while `observedAt + freshness window > server now`. Future or older observations are rejected. Confirmation is a new row with its own observedAt and server reportedAt; no older timestamps are refreshed.
- Consider only visible observations in reviewed directions, after the latest administrative review. A hidden parent removes its confirmations from live evidence. History is retained.
- One user contributes only their newest fresh observation per direction (ties: server timestamp, then report ID). Multiple observations from one person cannot increase support.
- Zero people: unknown. Any opposing fresh statuses: conflicting, regardless of majority or newest report. Otherwise the agreed status is unconfirmed until at least two independent people have adequate submitted location evidence. Independent agreeing observations beyond the first are the displayed confirmation count; conflicting evidence has no agreed confirmation count. A single report always remains unconfirmed.
- A location-wide marker uses a common status only when all directions agree. Opposing reports inside a direction show conflict; differing travel directions alone yield a neutral location-wide unknown. Route penalties use only a common confirmed congested/closed status (heavy congestion maps to the existing congestion penalty). No safety guarantee or measured traffic is inferred.
- Confirmation targets a fresh original report in the same direction, cannot predate it, cannot be by its reporter and is unique per reporter/target. Reports and confirmations share a user-wide 60-second cooldown, transaction locks, authentication and the existing Redis API rate limits. Root reports retain the existing five-point reward/cooldown; the existing reward settlement convention is retained, with contradictions scoped to the same direction.
- Server checks claimed distance with haversine: distance plus submitted accuracy must be within the configured 1.5 km radius. Accuracy must be <=200 m, capture <=2 minutes old and within two minutes of observedAt. Coordinates/accuracy remain untrusted supporting evidence, never proof. Explicit `unverified=true` permits submission without adequate evidence; such evidence cannot alone confirm a state. Raw submitted user coordinates are never stored or broadcast.
- Public state/feed DTOs omit reporter IDs and identities. Private administration retains its existing authorized moderation access.

## Delivery, expiry and failure handling

Mutations atomically persist observations and outbox events. After commit, the API immediately broadcasts an invalidation through the existing Socket.IO/Redis adapter. Durable worker delivery repeats it on the existing one-second outbox schedule as a recovery fallback. Activation, moderation and maintenance expiry use the same immediate invalidation. Clients never apply event state payloads; they cancel older checkpoint requests and fetch authoritative state on invalidation/load/reconnect. The HTTP client consumes query cancellation signals. Delayed/replayed invalidations only cause a fresh read, never restore an older state.

The existing 30-second maintenance job schedules expiry invalidations using each checkpoint's next evidence deadline, even without new reports. Reads always aggregate against current time; clients poll every 15 seconds and conservatively show unknown at the first cached evidence expiry (one-second UI clock), until an authoritative fetch recomputes remaining evidence. Offline data is labelled with its last fetch time on both map and status screen. Reconnect fetches authoritative state. Keep the worker running for outbox delivery and expiry events.

Location is requested only on pressing submit/confirm, as a foreground one-shot read with a UI timeout; it is never continuously tracked by this feature. Permission denial offers an explicit unverified submission. Failed submissions keep direction/status/note drafts, do not show success, and are not silently queued for later upload. Success is shown only after the server response. The report history is labelled as user observations, never current verified infrastructure or guaranteed safe travel.

## Manual checks (not executed)

1. Import twice against a prepared database. Confirm existing IDs/coordinates stay unchanged, source references do not duplicate, road gates retain their kind, two missing-location entries create no markers, and new candidates cannot report until an ADMIN reviews coordinates, supplies actual directions and explicitly activates. Verify a normal user cannot activate.
2. Use two authenticated clients at one activated site. Submit in each direction and confirm/reject competing observations through new reports. Verify immediate invalidation/refetch, isolated directions, lone unconfirmed reports, independent confirmation counts, unresolved conflicts, and rejection of self/duplicate/rapid confirmations. Inspect public responses/events for reporter privacy.
3. Let evidence expire without posting. Deny location and explicitly submit unverified; try distant/inaccurate/stale/future locations/times. Disconnect during submission, verify draft retention/no false success, cached labels and expiry to unknown, then reconnect and verify authoritative state replaces cache. Repeat in Arabic/English and RTL/LTR.

Legacy checkpoint test fixtures assume reporting without reviewed directions and a lone report immediately confirming status; those expectations must be revised for these new rules before running that suite.

Static review only: no tests, builds, browser automation, migration execution or data import was performed.
