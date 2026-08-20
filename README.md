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

## Running it

Requires Node.js 20 or newer.

```bash
npm run setup     # installs server and client dependencies
npm run dev       # API on :4000, client with hot reload on :5173
```

Open http://localhost:5173.

The first launch creates the database at `data/ssg.db` along with one project-manager
account — username `admin`, password `ssg-admin`. **Change that password immediately**, or
set `ADMIN_USERNAME` / `ADMIN_PASSWORD` before the first start.

### Production

```bash
npm run setup
npm run build     # bundles the client into client/dist
JWT_SECRET=$(openssl rand -hex 32) NODE_ENV=production npm start
```

In production the API serves the built client from the same origin on `PORT` (4000 by
default), so a single process is all that is needed behind your reverse proxy. `JWT_SECRET`
is required — the server refuses to start without it — and sign-in cookies are marked
`secure`, so serve the app over HTTPS. Copy `.env.example` to `.env` to set these.

### Sample data

To fill a fresh instance with the *Playce - Alam Sutera* schedule from the original
spreadsheet (creates users `ilham`, `kevin` and `gunarso`, password `ssg-2026`):

```bash
npm start &
node scripts/seed-demo.js
```

### Backups

Everything lives in `data/ssg.db` (SQLite, WAL mode). Copy that file — along with
`ssg.db-wal` if present — to back the app up, or point `DATA_DIR` somewhere you already
back up.

## Layout

```
server/
  index.js        Express app; also serves client/dist in production
  db.js           SQLite schema, the six default stages, first-run seed
  auth.js         Cookie/JWT sessions, role and PIC permission checks
  dates.js        The "first and last day picked" rule
  routes/         auth, users, projects, phases, tasks
client/src/
  pages/          Login, Projects, Schedule, People, Account
  components/     GanttChart, DatePickerPopover, TaskModal, ProjectModal, …
  lib/            API client, auth context, date helpers, shared types
scripts/
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
