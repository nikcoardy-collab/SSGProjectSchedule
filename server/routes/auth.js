import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { one, run } from '../db.js';
import { issueToken, clearToken, publicUser, requireAuth } from '../auth.js';
import { a } from '../util.js';

const router = Router();

router.post('/login', a(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = await one('SELECT * FROM users WHERE lower(username) = lower(?)', [username]);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  if (!user.active) {
    return res.status(403).json({ error: 'This account has been deactivated' });
  }

  issueToken(res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/logout', (req, res) => {
  clearToken(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/change-password', requireAuth, a(async (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (next.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  if (!bcrypt.compareSync(current, req.user.password)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  await run('UPDATE users SET password = ?, must_change = false WHERE id = ?', [
    bcrypt.hashSync(next, 10),
    req.user.id,
  ]);
  res.json({ ok: true });
}));

export default router;
