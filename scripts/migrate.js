/**
 * Applies supabase/schema.sql and makes sure one project-manager account exists.
 * Safe to run repeatedly.
 *
 *   DATABASE_URL=... node scripts/migrate.js
 *
 * Use the direct connection or the session pooler here — the transaction pooler
 * (port 6543) cannot run the DDL in this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { one, pool, run } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('[migrate] schema applied');

  const { c } = await one('SELECT count(*) AS c FROM users');
  if (c > 0) {
    console.log(`[migrate] ${c} account(s) already exist — nothing to seed`);
    return;
  }

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'ssg-admin';
  await run(
    `INSERT INTO users (username, name, email, password, role, must_change)
     VALUES (?, ?, '', ?, 'pm', true)`,
    [username, 'Project Manager', bcrypt.hashSync(password, 10)]
  );
  console.log(`[migrate] created project-manager account "${username}" (password: ${password})`);
  console.log('[migrate] change this password after the first sign-in.');
}

main()
  .catch((err) => {
    console.error('[migrate]', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
