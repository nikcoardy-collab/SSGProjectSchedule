import express, { Router } from 'express';
import { db, one, many, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { a, toId } from '../util.js';
import { isIsoDate } from '../dates.js';

const router = Router();
router.use(requireAuth);

/** Vercel caps request bodies around 4.5MB, so files are limited to 4MB. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

async function loadTaskDay(req, res) {
  const taskId = toId(req.params.id);
  const day = String(req.params.day || '');
  if (taskId === null || !isIsoDate(day)) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  const task = await one(
    `SELECT t.id, t.name, ph.project_id FROM tasks t
     JOIN phases ph ON ph.id = t.phase_id WHERE t.id = ?`,
    [taskId]
  );
  if (!task) {
    res.status(404).json({ error: 'Item not found' });
    return null;
  }
  return { task, day };
}

/** Everything attached to one day of one item — comments and file metadata. */
router.get('/tasks/:id/days/:day', a(async (req, res) => {
  const ctx = await loadTaskDay(req, res);
  if (!ctx) return;

  const comments = await many(
    `SELECT c.id, c.user_id, c.body, c.created_at, u.name AS user_name
     FROM task_day_comments c LEFT JOIN users u ON u.id = c.user_id
     WHERE c.task_id = ? AND c.day = ? ORDER BY c.id`,
    [ctx.task.id, ctx.day]
  );
  const files = await many(
    `SELECT f.id, f.user_id, f.name, f.mime, f.size, f.created_at, u.name AS user_name
     FROM task_day_files f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.task_id = ? AND f.day = ? ORDER BY f.id`,
    [ctx.task.id, ctx.day]
  );

  res.json({
    comments: comments.map((c) => ({
      id: c.id, userId: c.user_id, userName: c.user_name || 'Someone',
      body: c.body, createdAt: c.created_at,
    })),
    files: files.map((f) => ({
      id: f.id, userId: f.user_id, userName: f.user_name || 'Someone',
      name: f.name, mime: f.mime, size: f.size, createdAt: f.created_at,
    })),
  });
}));

router.post('/tasks/:id/days/:day/comments', a(async (req, res) => {
  const ctx = await loadTaskDay(req, res);
  if (!ctx) return;
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write something first' });
  if (body.length > 4000) return res.status(400).json({ error: 'Comment is too long (max 4000 characters)' });

  const row = await one(
    `INSERT INTO task_day_comments (task_id, day, user_id, body)
     VALUES (?, ?, ?, ?) RETURNING id`,
    [ctx.task.id, ctx.day, req.user.id, body]
  );
  res.status(201).json({ commentId: row.id });
}));

router.delete('/day-comments/:id', a(async (req, res) => {
  const id = toId(req.params.id);
  const c = id ? await one('SELECT * FROM task_day_comments WHERE id = ?', [id]) : null;
  if (!c) return res.status(404).json({ error: 'Comment not found' });
  if (c.user_id !== req.user.id && req.user.role !== 'pm') {
    return res.status(403).json({ error: 'You can only delete your own comments' });
  }
  await run('DELETE FROM task_day_comments WHERE id = ?', [id]);
  res.json({ ok: true });
}));

// The file body arrives raw; its name and type travel in headers so the JSON
// parser never touches it.
router.post(
  '/tasks/:id/days/:day/files',
  express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
  a(async (req, res) => {
    const ctx = await loadTaskDay(req, res);
    if (!ctx) return;

    const data = req.body;
    if (!Buffer.isBuffer(data) || data.length === 0) {
      return res.status(400).json({ error: 'The file arrived empty' });
    }
    let name = 'file';
    try {
      name = decodeURIComponent(String(req.headers['x-file-name'] || 'file')).slice(0, 200);
    } catch {
      /* keep the fallback name */
    }
    const mime = String(req.headers['x-file-mime'] || 'application/octet-stream').slice(0, 100);

    const row = await one(
      `INSERT INTO task_day_files (task_id, day, user_id, name, mime, size, data)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [ctx.task.id, ctx.day, req.user.id, name, mime, data.length, data]
    );
    res.status(201).json({ fileId: row.id });
  })
);

router.get('/day-files/:id', a(async (req, res) => {
  const id = toId(req.params.id);
  const f = id ? await one('SELECT * FROM task_day_files WHERE id = ?', [id]) : null;
  if (!f) return res.status(404).json({ error: 'File not found' });

  // Only images render inline; everything else downloads. Never serve a stored
  // file as HTML — it would run scripts under this app's origin.
  const isImage = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(f.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', isImage ? f.mime : 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `${isImage ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`
  );
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(f.data);
}));

router.delete('/day-files/:id', a(async (req, res) => {
  const id = toId(req.params.id);
  const f = id ? await one('SELECT id, user_id FROM task_day_files WHERE id = ?', [id]) : null;
  if (!f) return res.status(404).json({ error: 'File not found' });
  if (f.user_id !== req.user.id && req.user.role !== 'pm') {
    return res.status(403).json({ error: 'You can only delete your own files' });
  }
  await run('DELETE FROM task_day_files WHERE id = ?', [id]);
  res.json({ ok: true });
}));

export default router;
