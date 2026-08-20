# Deploying Probild CRM to Railway

Supabase runs the database, authentication and file storage. Railway runs
**one service**: a single Node process that serves the API, serves the built
React client, and runs the automation worker.

Everything comes from `railway.json`, so the service configures itself — build
command, start command, health check and restart policy all live in the repo.
The only thing you set by hand is the environment variables.

> **One deliberate trade.** The automation worker shares a process with the API.
> A long deadline scan therefore competes with live HTTP requests, which is the
> thing a separate worker process exists to prevent. It is fine at Probild's
> size; if the dashboard starts feeling slow while scans run, split the worker
> into its own service — `npm run worker:start -w @probild/api` is already the
> command for it, and `RUN_WORKER=false` turns off the in-process one.

---

## 1. Before you start

- Supabase **session-pooler** connection string, port **5432** (not 6543)
- Supabase publishable key (`sb_publishable_…`) and secret key (`sb_secret_…`)
- `ENCRYPTION_KEY` — copy the existing value out of `apps/api/.env`:

  ```bash
  grep '^ENCRYPTION_KEY=' apps/api/.env
  ```

  **Generating a new one breaks every Google Calendar connection** — the stored
  refresh tokens were encrypted with the old key and each person must reconnect.

- The two Storage buckets, both **private**: `probild-documents` and
  `probild-documents-test`.

## 2. Create the service

Railway → **New Project** → **Deploy from GitHub repo** → pick this repo.

Railway reads `railway.json` and configures build, start and health check
itself. Rename the service to something you will recognise (`probild`).

If you are not using GitHub, create an empty service and run `railway link`
then `railway up` from the repo root instead. Config-as-code still applies.

## 3. Add Redis

**+ New** → **Database** → **Add Redis**. The env block below references it as
`${{Redis.REDIS_URL}}`.

Without Redis the API still starts and serves — the worker fails, logs, and the
process carries on. Reminders simply stop being raised.

## 4. Environment variables

Generate the block with your real values:

```bash
./scripts/railway-env.sh
```

Paste it into **Variables → Raw Editor**, then replace the two placeholders it
cannot know: `SEED_ADMIN_PASSWORD`, and `CORS_ORIGINS` once the domain exists.

Do **not** set `PORT` — Railway injects it and the API reads it.
Do **not** set `TEST_DATABASE_URL` — it exists only for the test suite.

Three variables make the single-service shape work:

| Variable | Value | Why |
| --- | --- | --- |
| `SERVE_WEB` | `true` | Express serves `apps/web/dist` with an SPA fallback |
| `RUN_WORKER` | `true` | The automation worker runs in this process |
| `WEB_DIST_DIR` | `../web/dist` | Relative to `apps/api`, where the process runs |

Because the API and the client share one origin, there is no cross-origin
request to configure. `VITE_API_BASE_URL` stays **empty** — the browser calls
`/api` on the same host it loaded from.

## 5. Generate a domain

Service → **Settings → Networking → Generate Domain**.

Then set `CORS_ORIGINS` to that domain, with `https://` and no trailing slash.
Same-origin requests do not need CORS, but the config requires the variable and
it matters the moment anything else calls the API.

## 6. Keep it to one replica

Service → **Settings → Scale**. `railway.json` pins `numReplicas: 1`.

**Leave it there while `RUN_WORKER=true`.** Every replica would run its own
worker, so scheduled scans would fire two, three, N times over. If you need to
scale out, split the worker into its own service first.

## 7. First deploy

Deploy and watch the logs. In order you should see:

```
Automation worker starting
Automation schedule registered
Automation scan finished
Probild CRM API listening on http://localhost:8080
```

Then create the administrator, once, from the service shell:

```bash
npm run db:seed -w @probild/api
```

This creates the account in both Supabase Auth and the `users` table with a
shared id. It is idempotent; running it twice is safe.

**Sign in and change that password immediately.** It is sitting in your Railway
variables in plain text, which is not where a working credential belongs.

## 8. Check it works

In order — each depends on the one before:

1. `https://[domain]/api/health/ready` returns `"status":"ready"`
2. `https://[domain]/` loads the app; refreshing on `/clients` still works
3. Sign in with the seeded admin
4. Upload a document, then download it — proves Storage and the secret key
5. Logs show `Automation scan finished`
6. Settings → Google Calendar offers to connect — proves `ENCRYPTION_KEY` arrived

If the app loads but every call 401s, check `SUPABASE_PUBLISHABLE_KEY` matches
`VITE_SUPABASE_PUBLISHABLE_KEY`, and that both match the project.

## Optional integrations

Both are off unless configured, and say so rather than failing at the moment
someone presses the button.

**Google Calendar** — add `https://[domain]/api/calendar/google/callback` to the
OAuth client's authorised redirect URIs, then set `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI`.

**Sending documents** — set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASSWORD`, `SMTP_SECURE`, `MAIL_FROM_NAME`, `MAIL_FROM_ADDRESS`,
`MAIL_REPLY_TO`.

## Things worth knowing

**Session pooler, port 5432.** The API is a long-lived process and gains nothing
from the transaction pooler on 6543 — and 6543 breaks the interactive
transactions behind lead conversion, quotation acceptance and reference-number
allocation. Those fail under concurrency, not on a first smoke test.

**Region.** The Supabase project is in `ap-northeast-1` (Tokyo). Put Railway as
close to it as you can: every query is a round trip and the dashboard alone
makes 22 per load.

**Backups.** Supabase holds the data and the files; Railway holds no state.
Losing the Railway service costs a redeploy. The one thing that exists only in
Railway is `ENCRYPTION_KEY` — keep a copy somewhere safe.

**`probild-documents-test`** exists so the test suite cannot touch real
documents. Nothing in production reads or writes it.
