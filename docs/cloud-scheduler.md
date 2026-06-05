# Frequent crons via Google Cloud Scheduler

Vercel **Hobby** only allows **daily** cron jobs. CLOVE needs sub-daily runs:

- `/api/agent/cron` — runs autonomous agents on their schedule (every 5 min / hour)
- `/api/whale/refresh` — refreshes the Dune smart-money signal

`vercel.json` keeps these at a daily baseline. **Google Cloud Scheduler** drives
the real frequency by calling the same endpoints — free for 3 jobs/month, and
trivially cheap beyond that (covered by the $300 credit).

Both endpoints accept a `Authorization: Bearer <CRON_SECRET>` header (the same
`CRON_SECRET` from your env). Cloud Scheduler sends it.

## You need

- Your deployed URL, e.g. `https://clove.vercel.app`
- Your `CRON_SECRET` (in `.env.local` — also set it in Vercel → Project → Settings → Environment Variables)

## Option A — gcloud CLI (fastest)

```bash
# 1. One-time setup
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable cloudscheduler.googleapis.com

# 2. Agent execution — every 10 minutes
gcloud scheduler jobs create http clove-agent-cron \
  --location=us-central1 \
  --schedule="*/10 * * * *" \
  --uri="https://YOUR-APP.vercel.app/api/agent/cron" \
  --http-method=GET \
  --headers="Authorization=Bearer YOUR_CRON_SECRET"

# 3. Whale signal refresh — every 10 minutes
gcloud scheduler jobs create http clove-whale-refresh \
  --location=us-central1 \
  --schedule="*/10 * * * *" \
  --uri="https://YOUR-APP.vercel.app/api/whale/refresh" \
  --http-method=GET \
  --headers="Authorization=Bearer YOUR_CRON_SECRET"
```

Trigger a job immediately to test:

```bash
gcloud scheduler jobs run clove-whale-refresh --location=us-central1
```

## Option B — Google Cloud Console (no CLI)

1. **Console → Cloud Scheduler → Create job** (enable the API if prompted).
2. **Region**: `us-central1` (any is fine).
3. **Frequency**: `*/10 * * * *` (every 10 min). **Timezone**: your choice.
4. **Target type**: HTTP.
5. **URL**: `https://YOUR-APP.vercel.app/api/agent/cron`
6. **HTTP method**: GET.
7. **Auth header → Add header**:
   - Name: `Authorization`
   - Value: `Bearer YOUR_CRON_SECRET`
8. **Create**. Repeat for `https://YOUR-APP.vercel.app/api/whale/refresh`.

## Notes

- Cron syntax is standard 5-field. Examples: `*/5 * * * *` (5 min),
  `0 * * * *` (hourly), `0 */6 * * *` (every 6 h).
- The endpoints are idempotent — extra calls just re-check schedules / re-run
  the Dune queries. Safe to call often.
- Locally (dev), neither cron runs — the on-demand whale refresh and the manual
  **▶ Run Team** button cover testing.
