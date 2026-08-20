import jwt from 'jsonwebtoken';
import { one } from './db.js';
import { a } from './util.js';

export const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'production'
    ? (() => {
        throw new Error('JWT_SECRET must be set in production');
      })()
    : 'ssg-dev-secret-change-me');

const COOKIE = 'ssg_token';
const MAX_AGE = 1000 * 60 * 60 * 12; // 12 hours

export function issueToken(res, user) {
  const token = jwt.sign({ uid: user.id, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE,
    path: '/',
  });
}

export function clearToken(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email || '',
    role: u.role,
    active: !!u.active,
    mustChange: !!u.must_change,
  };
}

/** Populates req.user from the auth cookie; 401s when absent or stale. */
export const requireAuth = a(async (req, res, next) => {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  let uid;
  try {
    ({ uid } = jwt.verify(token, JWT_SECRET));
  } catch {
    clearToken(res);
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }

  const user = await one('SELECT * FROM users WHERE id = ?', [uid]);
  if (!user || !user.active) {
    clearToken(res);
    return res.status(401).json({ error: 'Account is no longer active' });
  }
  req.user = user;
  next();
});

export function requirePM(req, res, next) {
  if (req.user?.role !== 'pm') {
    return res.status(403).json({ error: 'Only a project manager can do this' });
  }
  next();
}

/**
 * A phase may be edited by any project manager, or by the user assigned as its PIC.
 * Returns the phase row, or null when the phase does not exist.
 */
export async function canEditPhase(user, phaseId) {
  const phase = await one('SELECT * FROM phases WHERE id = ?', [phaseId]);
  if (!phase) return { phase: null, allowed: false };
  return { phase, allowed: user.role === 'pm' || phase.pic_user_id === user.id };
}
