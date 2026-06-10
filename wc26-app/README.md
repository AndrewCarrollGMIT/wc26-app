# WC26 Group Tracker

Static dashboard for the FIFA World Cup 2026 group stage, with live scores
pulled from football-data.org via a serverless proxy (so the API token stays
hidden and one upstream call serves all viewers).

## Files

- `index.html` — the dashboard. Self-contained, includes all 48 teams, 72
  group fixtures, 16 stadiums. Renders without any API at all; the API just
  layers live scores and final results on top.
- `api/fixtures.js` — serverless function that proxies football-data.org.
  Reads the `FOOTBALL_DATA_TOKEN` from Vercel environment variables; the
  token never reaches the browser.
- `vercel.json` — Vercel project config.

## Deploy in 5 minutes

1. **Get a football-data.org token (free, no card)**
   - Go to https://www.football-data.org/client/register
   - Fill in email and password, click Register
   - Confirm via the email they send you
   - Log in, your token appears on your account page — copy it
   - Free tier: 10 requests/minute, no daily cap, covers WC 2026 fixtures,
     scores, and standings

2. **Push this folder to Vercel**
   - Easiest: drag this folder into https://vercel.com/new (after signing in
     with GitHub)
   - Or via the GitHub web flow if uploading by drag-and-drop into Vercel
     gives trouble (see Windows-specific notes below)

3. **Set the environment variable**
   - In your Vercel project: Settings → Environment Variables
   - Add `FOOTBALL_DATA_TOKEN` with your token as the value
   - Apply to all three environments (Production, Preview, Development)
   - Save

4. **Redeploy**
   - Deployments tab → ⋯ on the latest deployment → Redeploy

5. **Verify**
   - `https://<your-app>.vercel.app/api/fixtures` → should return JSON with
     a `fixtures` array (72 entries for group stage as the tournament begins)
   - `https://<your-app>.vercel.app/` → full dashboard

6. **Share the URL with the group chat**

## Windows: GitHub upload route

If dragging the folder into Vercel doesn't work cleanly on Windows:

1. Sign up at https://github.com (use the same Google or email login)
2. Create a new repository called `wc26-app` (public is fine)
3. Click "uploading an existing file"
4. Open the extracted `wc26-app` folder in File Explorer, select all the
   contents (Ctrl+A — including the `api` subfolder), drag onto the GitHub
   page
5. Commit
6. Go to https://vercel.com/new → Import your GitHub repo → Deploy
7. Continue with step 3 above (set env var, redeploy)

## How the live updates behave

- Frontend polls `/api/fixtures` every 60 seconds during live-match windows
  (based on the local fixture schedule), every 10 minutes otherwise.
- Serverless function edge-caches for 60 seconds. Six viewers polling at
  once = still one upstream call per minute, well under the free-tier
  10/minute ceiling.
- All kick-off times display in Sydney time (AEST, UTC+10).

## If something breaks

- **500 at `/api/fixtures`** → `FOOTBALL_DATA_TOKEN` env var not set or
  typoed. The variable name must be exact.
- **403/401** → token is wrong, or your account hasn't been confirmed.
- **429** → exceeded the 10 requests/minute rate limit. Reduce polling
  frequency by editing `POLL_LIVE_MS` in `index.html` (currently 60_000).
- **A team's live score doesn't appear in the standings** → almost
  certainly a name mismatch between our local data and football-data.org's
  feed. Add the upstream name to `TEAM_ALIASES` in `index.html`, redeploy.
