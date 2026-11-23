# Deploying, step by step

This is the guide to follow on the day. No prior Cloudflare experience assumed. If a step says
"you should see", stop and compare — if it does not match, that is where to ask for help.

There are **two plans**. Read this next paragraph, pick one, and ignore the other.

---

## Pick a plan

**Plan A — Cloudflare Workers (what we built).** Cheapest at scale, but it needs a Cloudflare account,
a second small service for PDFs, and two deployments to keep alive. Follow this if Workers is a hard
requirement.

**Plan B — one Node host (simplest).** Deploy the same app to Render as one normal web service. No
Cloudflare, no second process, about 20 minutes. The code we changed already supports this: with
`DOCUMENT_SERVICE_URL` unset, PDFs render in-process. Follow this if "get off Vercel quickly" is the
real goal.

> If you are unsure: **do Plan B first.** It gets you live today. Plan A can be done later without
> undoing anything — the Worker files just sit unused.

---

## Words used below

| Word | Plain meaning |
|---|---|
| **Worker** | Cloudflare's name for a serverless app — your Next.js app, running on their servers. |
| **wrangler** | Cloudflare's command-line tool. `npx wrangler …` runs it without installing anything globally. |
| **Hyperdrive** | Cloudflare's database connector. It holds a pool of Postgres connections so each request does not open a new one. You create one, it gives you an **id**, you paste that id into a config file. |
| **secret** | A password-like value (`AUTH_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`). Set with `wrangler secret put`; never written in a file you commit. |
| **binding** | A named connection the Worker sees at runtime (`HYPERDRIVE`, `ASSETS`). Declared in `wrangler.jsonc`. |
| **document service** | The small Node program in `document-service/` that draws the PDFs. Cloudflare's runtime cannot run the PDF library, so it lives separately. |
| **Render** | A hosting company. Used here as "somewhere to run a Node program" — Railway and Fly work too. |

---

# Plan A — Cloudflare Workers

## A0. Accounts

You need three, all free to start:

1. **GitHub** — you already have this (the repo is `CimmerianCrane/HELPDESK`).
2. **Cloudflare** — sign up at <https://dash.cloudflare.com/sign-up>. You will also move the
   `cranedesk.app` domain here later (step A9).
3. **Render** — sign up at <https://render.com> with your GitHub account. This hosts the document
   service.

Also have open: your **Supabase** project → **Settings → Database → Connection string**.

## A1. Put the code on GitHub

The migration is currently uncommitted on your machine. From the project folder:

```bash
git switch -c feature/cloudflare-workers
git add -A
git commit -m "Port to Cloudflare Workers with a split document service"
git push -u origin feature/cloudflare-workers
```

Then on GitHub open a pull request `feature/cloudflare-workers → dev`, and merge it. (Ask me and I will
do this whole step for you with `gh`.)

**You should see:** your changes on GitHub under the `dev` branch.

## A2. Build and deploy the document service on Render

1. Render dashboard → **New +** → **Web Service** → connect the **HELPDESK** repo.
2. Fill in:
   - **Name:** `cimmerian-documents`
   - **Language:** **Docker**
   - **Branch:** `dev`
   - **Dockerfile Path:** `document-service/Dockerfile`
   - **Docker Build Context Directory:** `.` (the repo root — this matters)
   - **Region:** Singapore if offered, otherwise the nearest to Singapore.
   - **Instance type:** the cheapest paid one (free instances sleep, which you do not want for PDFs).
3. **Environment variables** (Render calls them "Environment"):
   - `DOCUMENT_SERVICE_SECRET` = a long random string. Generate one in PowerShell:
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
     **Write it down** — the Worker needs the same value.
   - `PORT` = `8788` (the Dockerfile already exposes it, this is belt and braces).
4. Click **Create Web Service** and wait for the deploy.

**You should see:** Render logs ending with `{"service":"documents","message":"listening","port":8788}`.

5. Open `https://cimmerian-documents.onrender.com/health` in a browser.
   **You should see:** `{"status":"ok"}`.
   **Write down that full URL** — it is `DOCUMENT_SERVICE_URL` in step A4.

## A3. Log wrangler in and create Hyperdrive

In the project folder:

```bash
npx wrangler login
```

**You should see:** a browser window asking you to authorise Cloudflare, then "Successfully logged in".

Now create the database connector. Copy the **Direct connection** string from Supabase
(*Connect* button → **Direct connection** → copy the `postgresql://…:5432/…` URI) and run:

```bash
npx wrangler hyperdrive create cimmerian-crane --connection-string="<paste that URI here>"
```

**You should see:** output containing `id = "xxxxxxxxxxxxxxxx"`. **Copy that id.**

## A4. Fill in `wrangler.jsonc`

Open `wrangler.jsonc` in VS Code and replace two placeholders:

```jsonc
"hyperdrive": [
  { "binding": "HYPERDRIVE", "id": "PASTE_HYPERDRIVE_ID_HERE" }   // ← from A3
],
"vars": {
  "DOCUMENT_SERVICE_URL": "https://cimmerian-documents.onrender.com",  // ← from A2
  ...
}
```

Save the file.

## A5. Set the Worker's secrets

Each command prompts you to paste a value, then press Enter. Run them one at a time:

```bash
npx wrangler secret put AUTH_SECRET                # generate like the one in A2
npx wrangler secret put CRON_SECRET                # generate like the one in A2
npx wrangler secret put DOCUMENT_SERVICE_SECRET    # the SAME value as A2
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY  # Supabase → Settings → API → service_role
npx wrangler secret put VAPID_PRIVATE_KEY          # only if you use push; skip otherwise
```

**You should see:** `✨ Success! Uploaded secret AUTH_SECRET` after each.

## A6. Apply database migrations (once)

From your machine, with `.env` pointing at the production Supabase database:

```bash
npm run db:deploy
```

**You should see:** `All migrations have been successfully applied.` (or "No pending migrations").

## A7. Run it locally before deploying

Two things to know before this command:

- `wrangler dev` reads any `.env*` file in this folder **and those values win over `.dev.vars`**.
  Your local `.env` has `APP_BASE_URL=localhost` and an empty `CRON_SECRET`, which makes the app
  refuse to start in "production" mode. So **rename `.env` while you test**:

  ```powershell
  ren .env .env.parked
  copy .dev.vars.example .dev.vars     # then put real values in it (see the comments inside)
  ```

- A local Worker needs a real Postgres URL for Hyperdrive. In PowerShell, set it for this session:

  ```powershell
  $env:CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="<supabase Direct connection URI>"
  ```

Then:

```bash
npm run cf:preview
```

It prints a local URL (usually `http://localhost:8787`). Open `<that url>/api/health`.

**You should see:** `{"status":"ok","db":"up",...}`.
If `db` is `down`, the Hyperdrive string or database URL is wrong — stop here.

Then open `/login` and sign in. If you get "Invalid environment configuration", it lists what is
missing; put that value in `.dev.vars`.

When finished, restore your normal setup:

```powershell
ren .env.parked .env
del .dev.vars
```

## A8. Deploy staging, test, then production

```bash
npm run cf:deploy
```

This builds **and** uploads, which `wrangler deploy` alone does not — always use `npm run cf:deploy`
so you never upload a stale build.

**You should see:** `Deployed cimmerian-crane-helpdesk` and a `https://cimmerian-crane-helpdesk.<you>.workers.dev` URL.

On that URL, test in this order:

1. `/login` — sign in.
2. Open an **invoice → Download PDF**. It should download a real file.
3. Approve a service report (or open one) — PDF downloads.
4. On a phone, open `/m/login`, sign in, check the job list and one offline report.

Only when all four work, do the DNS step.

## A9. Point your domain at the Worker

1. Cloudflare dashboard → **Workers & Pages** → `cimmerian-crane-helpdesk` → **Settings** →
   **Domains & Routes** → **Add** → **Custom domain** → `cranedesk.app`.
2. If the domain is not yet on Cloudflare, add it under **Websites → Add a site** first and change the
   nameservers at your registrar to the two Cloudflare gives you.

**You should see:** the custom domain listed as Active. Keep the Vercel project running for a week as
your rollback.

## A10. Clean up (after a quiet week)

Delete the Vercel project, and delete `vercel.json` from the repo.

---

# Plan B — one Node host (simpler)

Same code, no Cloudflare, no second service.

1. `A1` above (push the code).
2. Render dashboard → **New +** → **Web Service** → connect **HELPDESK**.
   - **Language:** Node
   - **Branch:** `dev`
   - **Build Command:** `npm ci && npm run build`
   - **Start Command:** `npm start`
   - **Environment:** copy every variable from `.env.example` with your real values, and **do not**
     set `DOCUMENT_SERVICE_URL` or `DOCUMENT_SERVICE_SECRET` (leaving it unset makes PDFs render
     in-process, which works on Node).
   - Add `NODE_ENV=production`, `AUTH_SECRET`, `CRON_SECRET`, `APP_BASE_URL=https://<your render URL>`,
     `DATABASE_URL`, `DIRECT_URL`, `STORAGE_DRIVER=supabase`, `SUPABASE_URL`,
     `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`.
3. Apply migrations: `npm run db:deploy` locally against the production database.
4. Test the Render URL: `/api/health` → `db: up`, then `/login`, then a PDF download.
5. Point `cranedesk.app` at Render: Render → **Settings → Custom Domain**, then the DNS record it shows
   at your registrar.

**Cron note for Plan B:** Render's free tier has no scheduled jobs. Either use a paid instance with
"Render Cron Jobs" hitting `https://<your url>/api/cron/daily` with
`Authorization: Bearer <CRON_SECRET>`, or use a free external cron service for the same request.

---

# If something goes wrong

| Message | Meaning / fix |
|---|---|
| `Invalid environment configuration … must be set in production` | A secret is missing. It lists which. Run the matching `wrangler secret put`. |
| `/api/health` shows `db: down` | The Hyperdrive connection string or `DATABASE_URL` is wrong, or the Supabase project is paused. |
| `REPLACE_WITH_HYPERDRIVE_ID` in an error | Step A4 was skipped or the id was not saved. |
| PDF download fails, everything else works | The Render document service is asleep or down. Open its `/health`; if asleep, upgrade off the free tier. |
| `Invalid URL string` on startup | A stale `.env` is being loaded by `wrangler dev`. Move `.env` out of the folder while testing, and **never deploy from a machine with `.env` present**. |
