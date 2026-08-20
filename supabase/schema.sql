-- SSG Project Schedule — Postgres schema (Supabase).
-- Safe to run more than once; scripts/migrate.js applies this file.

CREATE TABLE IF NOT EXISTS users (
  id          integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  username    text        NOT NULL,
  name        text        NOT NULL,
  email       text        NOT NULL DEFAULT '',
  password    text        NOT NULL,
  role        text        NOT NULL DEFAULT 'user' CHECK (role IN ('pm', 'user')),
  active      boolean     NOT NULL DEFAULT true,
  must_change boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Usernames are matched case-insensitively, so uniqueness must be too.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username));

CREATE TABLE IF NOT EXISTS projects (
  id          integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name        text        NOT NULL,
  company     text        NOT NULL DEFAULT '',
  location    text        NOT NULL DEFAULT '',
  client      text        NOT NULL DEFAULT '',
  description text        NOT NULL DEFAULT '',
  start_date  text        NOT NULL,
  status      text        NOT NULL DEFAULT 'Active'
              CHECK (status IN ('Active', 'On Hold', 'Complete', 'Cancelled')),
  position    integer     NOT NULL DEFAULT 0,
  created_by  integer     REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS phases (
  id          integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  project_id  integer     NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name        text        NOT NULL,
  position    integer     NOT NULL DEFAULT 0,
  pic_user_id integer     REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phases_project ON phases (project_id);

CREATE TABLE IF NOT EXISTS tasks (
  id             integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  phase_id       integer     NOT NULL REFERENCES phases (id) ON DELETE CASCADE,
  name           text        NOT NULL,
  status         text        NOT NULL DEFAULT 'Not Started'
                 CHECK (status IN ('Not Started', 'In Progress', 'Complete', 'Blocked')),
  -- ISO 'YYYY-MM-DD' strings rather than date columns: the app treats a day as a
  -- label, and text keeps it free of timezone shifts on the way in and out.
  start_date     text,
  end_date       text,
  selected_dates jsonb       NOT NULL DEFAULT '[]'::jsonb,
  assignee_id    integer     REFERENCES users (id) ON DELETE SET NULL,
  notes          text        NOT NULL DEFAULT '',
  position       integer     NOT NULL DEFAULT 0,
  created_by     integer     REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_phase ON tasks (phase_id);

CREATE TABLE IF NOT EXISTS activity (
  id         integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  project_id integer     REFERENCES projects (id) ON DELETE CASCADE,
  user_id    integer     REFERENCES users (id) ON DELETE SET NULL,
  action     text        NOT NULL,
  detail     text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_project ON activity (project_id, id DESC);

-- Every table is reached only through this app's API, which authenticates with its
-- own session cookie and checks roles per request. Row level security is enabled so
-- that the anon and authenticated Supabase API keys cannot read these tables
-- directly; no policies are granted to them. The server connects as the Postgres
-- role from DATABASE_URL, which bypasses RLS.
ALTER TABLE users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE phases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

-- ── v2: item dependencies ──────────────────────────────────────────────────
-- A task may name one task it comes after. While that predecessor is not
-- Complete, the dependent task is shown and enforced as Blocked.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS depends_on integer REFERENCES tasks (id) ON DELETE SET NULL;

-- ── v3: per-day comments, files and photos on a task ───────────────────────
CREATE TABLE IF NOT EXISTS task_day_comments (
  id         integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  task_id    integer     NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  day        text        NOT NULL,
  user_id    integer     REFERENCES users (id) ON DELETE SET NULL,
  body       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_day_comments ON task_day_comments (task_id, day);

CREATE TABLE IF NOT EXISTS task_day_files (
  id         integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  task_id    integer     NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  day        text        NOT NULL,
  user_id    integer     REFERENCES users (id) ON DELETE SET NULL,
  name       text        NOT NULL,
  mime       text        NOT NULL DEFAULT 'application/octet-stream',
  size       integer     NOT NULL,
  data       bytea       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_day_files ON task_day_files (task_id, day);

ALTER TABLE task_day_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_day_files    ENABLE ROW LEVEL SECURITY;

-- ── v4: an item can come after several items ───────────────────────────────
CREATE TABLE IF NOT EXISTS task_deps (
  task_id    integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  depends_on integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on)
);
-- Carry over single-column links from v2, then retire the column.
INSERT INTO task_deps (task_id, depends_on)
  SELECT id, depends_on FROM tasks WHERE depends_on IS NOT NULL
  ON CONFLICT DO NOTHING;
UPDATE tasks SET depends_on = NULL WHERE depends_on IS NOT NULL;
ALTER TABLE task_deps ENABLE ROW LEVEL SECURITY;
