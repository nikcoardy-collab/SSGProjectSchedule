import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { issueToken, clearToken, publicUser, requireAuth } from '../auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  if (!user.active) {
    return res.status(403).json({ error: 'This account has been deactivated' });
  }

  issueToken(res, user);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  clearToken(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/change-password', requireAuth, (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (next.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  if (!bcrypt.compareSync(current, req.user.password)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  db.prepare('UPDATE users SET password = ?, must_change = 0 WHERE id = ?')
    .run(bcrypt.hashSync(next, 10), req.user.id);
  res.json({ ok: true });
});

export default router;
