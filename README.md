# status.n3rdlabs.dev

Status page for every n3rdlabs project: whether each one is up right now, 90 days of uptime, and planned updates with when they start and when things should be back.

It deliberately runs on GitHub, not on the netcup box, so it stays reachable when that server is down or rebooting.

## How it works

- `docs/` is the page, served by GitHub Pages at status.n3rdlabs.dev (`docs/CNAME`; DNS is a `status` CNAME to `freecreeper.github.io` at Namecheap).
- `docs/services.json` lists each project and the URLs that must answer for it to count as up. Lodge and Brewbook also check their backend health endpoints, so "page loads but backend is dead" shows as **partly down**.
- `.github/workflows/check.yml` runs `scripts/check.mjs`. A failed request is retried once after 5 s before it counts.
- **What starts it:** cron-job.org (job "n3rdlabs status check", Zane's account) POSTs to the workflow's `dispatches` API every 5 minutes with a fine-grained token that can only run Actions in this repo. GitHub's own `*/5` schedule is still in the workflow as a backup, but it never fired after setup on 2026-10-22, so don't rely on it alone. Pushes to `services.json`, `maintenance.json` or the checker also run a check.
- **When the token expires** (about a year after 2026-10-22), cron-job.org emails after 3 failed runs and the page starts showing "may be out of date". Make a new fine-grained token (only this repo, Actions: read and write) and paste `Bearer <token>` into the job's Authorization header.
- Results go to the `data` branch (`status.json`, `history.json`), which is replaced by a single commit each run so it never grows. The page reads them from raw.githubusercontent.com and refreshes every minute.
- Downtime during an announced window is recorded as a planned update, not an outage.

## Posting a planned update

Add an entry to `docs/maintenance.json` and push to `main`:

```json
{
  "maintenance": [
    {
      "id": "2026-10-24-lodge-update",
      "title": "Lodge update",
      "services": ["lodge"],
      "start": "2026-10-24T21:00:00-04:00",
      "end": "2026-10-24T21:30:00-04:00",
      "details": "New room features. Calls drop and reconnect on their own."
    }
  ]
}
```

- `services` uses the `id`s from `services.json`.
- `end` is when things are expected back. If it finishes early, add `"finishedAt"` with the real time.
- Upcoming and in-progress updates show at the top; finished ones stay under "Recent updates" for 14 days.
- Visitors see every time converted to their own time zone.

## Local preview

`npx http-server docs -p 4174`, then open `http://localhost:4174/?data=/_data/` after running `node scripts/check.mjs prev docs/_data` once. `_data/` and `_preview/` are git-ignored.
