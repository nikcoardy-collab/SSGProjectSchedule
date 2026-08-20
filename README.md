# SSG Project Schedule

A web version of the Solusi Golf Simulator project timeline — the spreadsheet where each
tab is a project becomes an app where each project has its own Gantt schedule that the
team contributes to.

<!-- Screens: sign-in → project list → schedule (Gantt) → multi-day picker -->

## How it works

**Roles**

| | Project manager | User (contributor) |
|---|---|---|
| Sign in | ✔ | ✔ |
| See every project's schedule | ✔ | ✔ |
| Create / edit / delete projects | ✔ | — |
| Assign the PIC of a stage | ✔ | — |
| Add, edit, delete items in a stage | every stage | only stages they are PIC of |
| Create accounts | ✔ | — |

There is no public sign-up. The project manager creates each account on the **People**
page and hands over the username and starting password; everyone can change their own
password from their account page.

**Projects and stages**

A project manager creates a project with its name, company, site, client and start date.
Every new project opens with the six standard stages, in order:

1. Tender
2. Procurement
3. Production
4. Installation
5. Handover
6. Calibration / Testing / Final Handover

A PIC can be assigned to each stage at creation time or later (click the PIC badge on the
stage row). Extra stages can be added to a project with **+ Stage** if one is needed on top
of the standard flow.

**Sub-timelines**

Inside a stage, the project manager and that stage's PIC add sub-timeline items — the
individual jobs like *Preliminary Survey*, *Order*, *Padding*, *Trackman iO Calibration*.
Each item carries a status (Not Started / In Progress / Complete / Blocked), an optional
owner and notes.

**Dates**

Click an item's Start or End cell to open the day picker. Pick as many days as the work
needs — shift-click selects a run of days, **Fill span** selects everything between the
first and last pick, **Weekdays** drops the weekends.

> The start date is the **first** day picked and the end date is the **last**.

The individual picks are kept, not just the range, so the bar on the chart shows the exact
days worked and leaves gaps for the days in between. The stage header row rolls its items
up into one span, and the Days column shows the inclusive length of each bar.

## Running it locally

Requires Node.js 20 or newer and a Postgres database — a free Supabase project works,
and so does a local Postgres.

```bash
npm run setup                                  # installs server and client dependencies
cp .env.example .env                           # then fill in DATABASE_URL and JWT_SECRET
npm run db:push                                # creates the tables and the first PM account
npm run dev                                    # API on :4000, client with hot reload on :5173
```

Open http://localhost:5173.

`npm run db:push` creates one project-manager account — username `admin`, password
`ssg-admin`. **Change that password immediately**, or set `ADMIN_USERNAME` /
`ADMIN_PASSWORD` in `.env` before running it.

## Deploying to Vercel + Supabase

### 1. Create the Supabase database

Create a project at [supabase.com](https://supabase.com), then open **Project Settings →
Database → Connection string**. Two of the strings there matter, and they are used for
different things:

| Connection | Port | Used for |
|---|---|---|
| **Direct** (`db.<ref>.supabase.co`) | 5432 | running migrations from your machine |
| **Transaction pooler** (`...pooler.supabase.com`) | 6543 | the app running on Vercel |

The distinction matters. Serverless functions open and drop database connections
constantly, and Postgres runs out of connection slots long before it runs out of
capacity — the pooler exists to absorb that. Conversely the transaction pooler cannot
run the `CREATE TABLE` statements in the schema, so migrations need the direct string.

Create the tables from your machine using the **direct** string:

```bash
DATABASE_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \
  ADMIN_PASSWORD="pick-something-better" npm run db:push
```

You can also paste `supabase/schema.sql` into the Supabase SQL Editor and run it there,
but then you have to create the first project-manager account yourself — `db:push`
does both.

### 2. Deploy to Vercel

Push this repository to GitHub, then **Add New → Project** in Vercel and import it. The
`vercel.json` in the repo already sets the build command, the output directory and the
routing, so leave the framework preset as "Other".

Add these **Environment Variables** before the first deploy:

| Name | Value |
|---|---|
| `DATABASE_URL` | the **transaction pooler** string, port **6543** |
| `JWT_SECRET` | a long random string — `openssl rand -hex 32` |

`NODE_ENV` is set to `production` by Vercel itself. Do not set `ADMIN_PASSWORD` there;
the account already exists from step 1, and the app never seeds on startup.

Deploy. Everything under `/api/*` runs as one serverless function and the built client
is served from Vercel's CDN, so it is all one origin and the session cookie just works.

For the best latency, set the Vercel project's function region (**Settings → Functions**)
to the region your Supabase project is in — otherwise every query crosses continents.

### 3. After deploying

Sign in as `admin`, change the password on the account page, then create accounts for
the team on the **People** page.

### Notes on the setup

- **Sessions.** Sign-in uses a signed, `HttpOnly`, `SameSite=Lax` cookie, marked
  `Secure` in production. Nothing is stored server-side, so it survives the serverless
  functions being recycled — but changing `JWT_SECRET` signs everyone out.
- **Row level security** is enabled on every table with no policies granted, so the
  Supabase `anon` and `authenticated` API keys cannot read the data directly. All access
  goes through this app's API, which checks the role and PIC rules on each request.
- **Backups** are Supabase's job — daily backups are included, under Database → Backups.

### Sample data

To fill an instance with the *Playce - Alam Sutera* schedule from the original
spreadsheet (creates users `ilham`, `kevin` and `gunarso`, password `ssg-2026`):

```bash
node scripts/seed-demo.js https://<your-app>.vercel.app admin <your-admin-password>
```

Leave the arguments off to seed a local instance on port 4000 instead.

## Layout

```
api/
  index.js        Vercel serverless entry — the API only
server/
  app.js          Express app factory, shared by Vercel and local runs
  index.js        Local server; also serves client/dist
  db.js           Postgres pool, query helpers, transactions
  auth.js         Cookie/JWT sessions, role and PIC permission checks
  dates.js        The "first and last day picked" rule
  util.js         Async route wrapper and row-id validation
  routes/         auth, users, projects, phases, tasks
client/src/
  pages/          Login, Projects, Schedule, People, Account
  components/     GanttChart, DatePickerPopover, TaskModal, ProjectModal, …
  lib/            API client, auth context, date helpers, shared types
supabase/
  schema.sql      Tables, indexes and RLS — applied by npm run db:push
scripts/
  migrate.js      Applies the schema and seeds the first PM account
  seed-demo.js    Loads the sample project over the API
```

## API

All endpoints are under `/api` and require the session cookie except `POST /api/auth/login`.

| Method | Path | Who |
|---|---|---|
| POST | `/auth/login`, `/auth/logout`, `/auth/change-password` | anyone / signed in |
| GET | `/auth/me`, `/users` | signed in |
| GET/POST/PATCH/DELETE | `/users*` | project manager |
| GET | `/projects`, `/projects/:id`, `/projects/:id/activity` | signed in |
| POST/PATCH/DELETE | `/projects*` | project manager |
| POST/DELETE | `/phases`, `/phases/:id` | project manager |
| PATCH | `/phases/:id` | project manager, or the stage's PIC (rename only) |
| POST/PATCH/DELETE | `/tasks*` | project manager, or the stage's PIC |
