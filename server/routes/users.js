import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { many, one, run } from '../db.js';
import { publicUser, requireAuth, requirePM } from '../auth.js';
import { a, idParam } from '../util.js';

const router = Router();
router.use(requireAuth);
router.param('id', idParam);

/** Every signed-in user needs the roster to read PIC names off the schedule. */
router.get('/', a(async (req, res) => {
  const rows = await many(
    "SELECT * FROM users WHERE active = true ORDER BY role DESC, lower(name)"
  );
  res.json({ users: rows.map(publicUser) });
}));

router.get('/all', requirePM, a(async (req, res) => {
  const rows = await many('SELECT * FROM users ORDER BY active DESC, lower(name)');
  res.json({ users: rows.map(publicUser) });
}));

router.post('/', requirePM, a(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  const role = req.body?.role === 'pm' ? 'pm' : 'user';

  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    return res.status(400).json({
      error: 'Username must be 3-32 characters, letters/numbers/dot/dash/underscore only',
    });
  }
  if (!name) return res.status(400).json({ error: 'Full name is required' });
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const clash = await one('SELECT id FROM users WHERE lower(username) = lower(?)', [username]);
  if (clash) return res.status(409).json({ error: 'That username is already taken' });

  const user = await one(
    `INSERT INTO users (username, name, email, password, role, must_change)
     VALUES (?, ?, ?, ?, ?, true) RETURNING *`,
    [username, name, email, bcrypt.hashSync(password, 10), role]
  );
  res.status(201).json({ user: publicUser(user) });
}));

router.patch('/:id', requirePM, a(async (req, res) => {
  const id = Number(req.params.id);
  const user = await one('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const name = req.body?.name === undefined ? user.name : String(req.body.name).trim();
  const email = req.body?.email === undefined ? user.email : String(req.body.email).trim();
  const role = req.body?.role === undefined ? user.role : req.body.role === 'pm' ? 'pm' : 'user';
  const active = req.body?.active === undefined ? user.active : !!req.body.active;

  if (!name) return res.status(400).json({ error: 'Full name is required' });

  // Never let the last active project manager lock everyone out.
  const { c: otherPMs } = await one(
    "SELECT count(*) AS c FROM users WHERE role = 'pm' AND active = true AND id <> ?",
    [id]
  );
  if (user.role === 'pm' && user.active && otherPMs === 0 && (role !== 'pm' || !active)) {
    return res.status(400).json({ error: 'At least one active project manager must remain' });
  }

  if (req.body?.password !== undefined && req.body.password !== '') {
    const pw = String(req.body.password);
    if (pw.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    await run('UPDATE users SET password = ?, must_change = true WHERE id = ?', [
      bcrypt.hashSync(pw, 10),
      id,
    ]);
  }

  const updated = await one(
    'UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ? RETURNING *',
    [name, email, role, active, id]
  );
  res.json({ user: publicUser(updated) });
}));

router.delete('/:id', requirePM, a(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  const user = await one('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { c: otherPMs } = await one(
    "SELECT count(*) AS c FROM users WHERE role = 'pm' AND active = true AND id <> ?",
    [id]
  );
  if (user.role === 'pm' && otherPMs === 0) {
    return res.status(400).json({ error: 'At least one active project manager must remain' });
  }

  // Keep history intact: deactivate rather than drop the row.
  await run('UPDATE users SET active = false WHERE id = ?', [id]);
  res.json({ ok: true });
}));

export default router;
