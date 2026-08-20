import pg from 'pg';

const { Pool } = pg;

/**
 * node-pg hands back `bigint` (OID 20) as a string to avoid precision loss. Every
 * bigint this app produces is a COUNT, so read them as numbers.
 */
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

function poolConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set — point it at your Supabase connection string ' +
        '(use the transaction pooler on port 6543 when running on Vercel).'
    );
  }

  const ca = process.env.SUPABASE_CA_CERT;
  return {
    connectionString,
    // One socket per serverless instance: the pooler multiplexes, so a local pool
    // larger than this only burns connections that other instances need.
    max: Number(process.env.PGPOOL_MAX) || (process.env.VERCEL ? 1 : 10),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
      ? false
      : ca
        ? { ca }
        : { rejectUnauthorized: false },
  };
}

// A warm serverless instance reuses its pool across invocations; without this each
// module reload would open a fresh set of connections.
const globalPg = globalThis;
export const pool = globalPg.__ssgPool ?? new Pool(poolConfig());
if (!globalPg.__ssgPool) {
  globalPg.__ssgPool = pool;
  pool.on('error', (err) => console.error('[db] idle client error', err));
}

const placeholderCache = new Map();

/**
 * Rewrites `?` placeholders into Postgres `$1, $2, …`. Question marks inside string
 * literals are left alone.
 */
function toPgPlaceholders(text) {
  const cached = placeholderCache.get(text);
  if (cached) return cached;

  let out = '';
  let n = 0;
  let inString = false;
  for (const ch of text) {
    if (ch === "'") inString = !inString;
    if (ch === '?' && !inString) {
      n += 1;
      out += `$${n}`;
    } else {
      out += ch;
    }
  }
  placeholderCache.set(text, out);
  return out;
}

function bind(runner) {
  return {
    async query(text, params = []) {
      return runner.query(toPgPlaceholders(text), params);
    },
    async one(text, params = []) {
      const { rows } = await runner.query(toPgPlaceholders(text), params);
      return rows[0] ?? null;
    },
    async many(text, params = []) {
      const { rows } = await runner.query(toPgPlaceholders(text), params);
      return rows;
    },
    async run(text, params = []) {
      return runner.query(toPgPlaceholders(text), params);
    },
  };
}

export const db = bind(pool);
export const { query, one, many, run } = db;

/** Runs `fn` inside a single transaction, rolling back if it throws. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(bind(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

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

/**
 * Column upgrades newer than the original schema. Each statement is idempotent,
 * so the deployed app can apply them itself on first use — no manual migration
 * step for the database owner.
 */
const UPGRADES = [
  'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS depends_on integer REFERENCES tasks (id) ON DELETE SET NULL',
];

let upgradesPromise = null;
export function schemaReady() {
  if (!upgradesPromise) {
    upgradesPromise = (async () => {
      for (const sql of UPGRADES) await pool.query(sql);
    })().catch((err) => {
      upgradesPromise = null; // retry on the next request
      throw err;
    });
  }
  return upgradesPromise;
}

export async function logActivity(projectId, userId, action, detail = '') {
  await run('INSERT INTO activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)', [
    projectId ?? null,
    userId ?? null,
    action,
    detail,
  ]);
}
