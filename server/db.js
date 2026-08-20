import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'ssg.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name         TEXT    NOT NULL,
  email        TEXT,
  password     TEXT    NOT NULL,
  role         TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('pm','user')),
  active       INTEGER NOT NULL DEFAULT 1,
  must_change  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  company      TEXT    NOT NULL DEFAULT '',
  location     TEXT    NOT NULL DEFAULT '',
  client       TEXT    NOT NULL DEFAULT '',
  description  TEXT    NOT NULL DEFAULT '',
  start_date   TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','On Hold','Complete','Cancelled')),
  position     INTEGER NOT NULL DEFAULT 0,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS phases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  pic_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_phases_project ON phases(project_id);

CREATE TABLE IF NOT EXISTS tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id       INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'Not Started'
                 CHECK (status IN ('Not Started','In Progress','Complete','Blocked')),
  start_date     TEXT,
  end_date       TEXT,
  selected_dates TEXT    NOT NULL DEFAULT '[]',
  assignee_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes          TEXT    NOT NULL DEFAULT '',
  position       INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_phase ON tasks(phase_id);

CREATE TABLE IF NOT EXISTS activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT    NOT NULL,
  detail      TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id, id DESC);
`);

/** The six fixed stages of every SSG project, in order. */
export const DEFAULT_PHASES = [
  'Tender',
  'Procurement',
  'Production',
  'Installation',
  'Handover',
  'Calibration / Testing / Final Handover',
];

export const TASK_STATUSES = ['Not Started', 'In Progress', 'Complete', 'Blocked'];

export function logActivity(projectId, userId, action, detail = '') {
  db.prepare(
    'INSERT INTO activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)'
  ).run(projectId ?? null, userId ?? null, action, detail);
}

/** Creates the first project-manager account if the users table is empty. */
export function seed() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (c > 0) return;

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'ssg-admin';
  db.prepare(
    `INSERT INTO users (username, name, email, password, role, must_change)
     VALUES (?, ?, ?, ?, 'pm', 1)`
  ).run(username, 'Project Manager', '', bcrypt.hashSync(password, 10));

  console.log(`[seed] created project-manager account "${username}" (password: ${password})`);
  console.log('[seed] change this password after the first login.');
}
