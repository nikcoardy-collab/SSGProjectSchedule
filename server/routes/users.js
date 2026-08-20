import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { publicUser, requireAuth, requirePM } from '../auth.js';

const router = Router();
router.use(requireAuth);

/** Every signed-in user needs the roster to read PIC names off the schedule. */
router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM users WHERE active = 1 ORDER BY role DESC, name COLLATE NOCASE')
    .all();
  res.json({ users: rows.map(publicUser) });
});

router.get('/all', requirePM, (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE').all();
  res.json({ users: rows.map(publicUser) });
});

router.post('/', requirePM, (req, res) => {
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
  const clash = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (clash) return res.status(409).json({ error: 'That username is already taken' });

  const info = db
    .prepare(
      `INSERT INTO users (username, name, email, password, role, must_change)
       VALUES (?, ?, ?, ?, ?, 1)`
    )
    .run(username, name, email, bcrypt.hashSync(password, 10), role);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(user) });
});

router.patch('/:id', requirePM, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const name = req.body?.name === undefined ? user.name : String(req.body.name).trim();
  const email = req.body?.email === undefined ? user.email : String(req.body.email).trim();
  let role = req.body?.role === undefined ? user.role : req.body.role === 'pm' ? 'pm' : 'user';
  let active = req.body?.active === undefined ? user.active : req.body.active ? 1 : 0;

  if (!name) return res.status(400).json({ error: 'Full name is required' });

  // Never let the last active project manager lock everyone out.
  const otherPMs = db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'pm' AND active = 1 AND id != ?")
    .get(id).c;
  if (user.role === 'pm' && user.active && otherPMs === 0 && (role !== 'pm' || !active)) {
    return res.status(400).json({ error: 'At least one active project manager must remain' });
  }

  db.prepare('UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?')
    .run(name, email, role, active, id);

  if (req.body?.password) {
    const pw = String(req.body.password);
    if (pw.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    db.prepare('UPDATE users SET password = ?, must_change = 1 WHERE id = ?')
      .run(bcrypt.hashSync(pw, 10), id);
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: publicUser(updated) });
});

router.delete('/:id', requirePM, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const otherPMs = db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'pm' AND active = 1 AND id != ?")
    .get(id).c;
  if (user.role === 'pm' && otherPMs === 0) {
    return res.status(400).json({ error: 'At least one active project manager must remain' });
  }

  // Keep history intact: deactivate rather than drop the row.
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
