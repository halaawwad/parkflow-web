# Server deployment: walking navigation and Gemini

This is the short checklist for deploying the walking-navigation release. The full hosting
guide (Neon, Render, Vercel, Supabase, Brevo) is [DEPLOYMENT.md](../DEPLOYMENT.md). Nothing here
replaces it.

## What this release adds on the server

| Item | Where | Action needed |
| --- | --- | --- |
| Walking routes (`profile: 'walking'`) | `server/src/modules/routing/service.ts` | None. Defaults work |
| `OSRM_FOOT_BASE_URL`, `OSRM_FOOT_PROFILE`, `ROUTING_USER_AGENT` | `server/src/config/env.ts` | Optional. Set to self-hosted values for production volume |
| `POST /routes/summary` (Gemini overview) | `server/src/modules/routing/summary.ts` | Optional. Needs `GEMINI_API_KEY` |
| Rate limits: `/routes/plan` 60/min, `/routes/summary` 20/min | `server/src/app.ts` | None |

There are no database migrations in this release.

## Environment variables

| Variable | Backend / frontend | Required | Default |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | backend only | no | unset (AI features off) |
| `GEMINI_MODEL` | backend only | no | `gemini-2.5-flash` |
| `OSRM_FOOT_BASE_URL` | backend only | no | `https://routing.openstreetmap.de/routed-foot` |
| `OSRM_FOOT_PROFILE` | backend only | no | `foot` |
| `ROUTING_USER_AGENT` | backend only | no | `ParkFlow/1.0 (+https://github.com/yazeedbesher12/ParkFlow)` |
| `EXPO_PUBLIC_API_BASE_URL` | frontend (public) | yes | none. The API base URL, not a secret |

Only `EXPO_PUBLIC_` variables reach the app bundle, and none of them is a secret.

## Local (Docker)

```bash
cd server
cp .env.example .env              # first time only; then edit .env (see GEMINI_SETUP.md)
docker compose up -d --build      # migrations run on backend start
curl http://localhost:4000/health # {"status":"ok"}
```

Restart after changing `.env`:

```bash
docker compose up -d --build backend worker
```

## Build and test before deploying

```bash
# app
npm ci
npm run typecheck
npm run test:navigation
npm run test:notifications
npm run test:network
npx expo export --platform web --output-dir dist-web

# server (tests need a Postgres database whose name ends in _test, see server/.env.example)
cd server
npm ci
npm run db:generate
npm run typecheck
npm run build
npm test
```

## Render (public demo)

1. Merge to `main`. The Render service auto-deploys on commit (`render.yaml`).
2. Optional: Dashboard → `parkflow-api` → Environment → add `GEMINI_API_KEY`, and the `OSRM_FOOT_*`
   variables if self-hosting the walking router.
3. Watch the logs for `ParkFlow API ready` and `Worker ready`.

## Verify the deployment

```bash
API=https://parkflow-api.onrender.com/api/v1     # or http://localhost:4000/api/v1
curl -s "$API/../health"
# With a token from the app (Settings is not needed; any signed-in session works):
curl -s -X POST "$API/routes/plan" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"origin":{"latitude":31.9038,"longitude":35.2044},"destination":{"latitude":31.9006,"longitude":35.2087},"profile":"walking","mode":"fastest"}' \
  | grep -o '"profile":"walking"\|"source":"[a-z-]*"'
```

You should see `"source":"osrm"` and `"profile":"walking"`. If you see `"source":"straight-line"`,
the server can't reach the walking router: check outbound access to `OSRM_FOOT_BASE_URL`.

## Self-hosting the walking router (production volume)

The FOSSGIS server is for fair use. For production traffic run OSRM yourself with the foot
profile on a Palestine extract from Geofabrik, then point `OSRM_FOOT_BASE_URL` at it. For
example, `http://osrm-foot:5000` with `OSRM_FOOT_PROFILE=foot`. Follow the OSRM backend docs
for building the graph (`osrm-extract -p profiles/foot.lua`, `osrm-partition`, `osrm-customize`,
`osrm-routed --algorithm mld`).
