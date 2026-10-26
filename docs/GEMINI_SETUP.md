# Gemini setup

ParkFlow uses Google Gemini **only on the server**, for three optional features:

| Feature | Model variable | Without a key |
| --- | --- | --- |
| Dashboard warning-light check (`/vehicle-warnings/check`) | `GEMINI_MODEL` | Returns 503 and the screen says the check is unavailable |
| Natural navigation voice (`/voice/speak`) | `GEMINI_TTS_MODEL`, `GEMINI_TTS_FALLBACK_MODELS`, `GEMINI_TTS_VOICE` | The device's own speech engine is used |
| Route overview in route details (`/routes/summary`) | `GEMINI_MODEL` | No overview is shown |

Navigation itself (routes, turns, rerouting, arrival) never depends on Gemini.

## Where to put your key

On the **server only**. Never in an `EXPO_PUBLIC_` variable, the app source, a commit, or a screenshot.

**Local development:** edit `server/.env` (copied from `server/.env.example`, git-ignored):

```env
GEMINI_API_KEY=paste-your-key-here
GEMINI_MODEL=gemini-2.5-flash
```

Then restart the backend:

```bash
cd server
docker compose up -d --build backend worker
```

**Render (public demo):** Dashboard → `parkflow-api` → Environment → **Add Environment
Variable** → `GEMINI_API_KEY` → Save. Render redeploys automatically.

`GEMINI_MODEL` is optional (default `gemini-2.5-flash`). Set it to any model your key can use.
The value must contain only letters, digits, `.`, `_` and `-`.

## How it is kept safe

- **The key is used only in `server/src/providers/gemini.ts`** and the two older Gemini
  services, which share the same approach. It travels only in the `x-goog-api-key` request
  header, never in a URL.
- **Errors never echo the key.** Provider failures are logged as a status code only.
  Clients receive `AI_NOT_CONFIGURED` or `AI_UNAVAILABLE`.
- **Timeouts, retries and rate limits:**
  - each request times out after 8 s;
  - rate limits (429) and server errors are retried twice with backoff, honouring `Retry-After`;
  - `/routes/summary` is limited to 20 requests per minute per client, and summaries are cached for 1 h.
- **Input is validated:** at most 60 steps, 160 characters each, and a 120-character destination name.

## The route overview is grounded

Gemini gets the instructions the routing provider already produced (the same text shown on
screen) and is told to add nothing. Its reply is then checked: if it mentions a number (a
distance, a time) that is not in the route, the reply is discarded and no overview is shown.
Gemini never decides a route, a turn or a distance.

## Why the REST API

ParkFlow already called Gemini's official REST API (`generativelanguage.googleapis.com/v1beta`)
for the warning check and the voice. The new client follows the same transport rather than
adding an SDK alongside it. Moving all three to the `@google/genai` SDK later is a contained
change in `server/src/providers/gemini.ts` and the two older services.

## Check it works

With the server running and a logged-in token:

```bash
curl -s -X POST http://localhost:4000/api/v1/routes/summary \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"profile":"walking","locale":"en","destinationName":"Al-Manara","distanceMeters":580,"durationSeconds":465,"steps":[{"instruction":"Turn left onto Ghassan Haarb","distanceMeters":90},{"instruction":"Arrive at your destination","distanceMeters":0}]}'
```

- `{"summary":"…","source":"gemini"}`: working.
- `"summary":null`: the reply was rejected as ungrounded. Try again, or check the model.
- `AI_NOT_CONFIGURED`: `GEMINI_API_KEY` is not set on that server.

In the app, open a route and tap **Route details**. The overview appears with a ✨ icon.

## Keeping the navigation voice available

Each voice model has its own quota. When `GEMINI_TTS_MODEL` runs out, the server moves to the next
model in `GEMINI_TTS_FALLBACK_MODELS` with the same voice, and every sentence it has spoken is kept
in the `voice_clips` table and reused for all drivers. On the free tier the daily quota of a voice
model is still small: for a voice that never drops out, enable billing on the Google Cloud project of
the voice key (Google AI Studio → API keys → the key's project → Set up billing).
