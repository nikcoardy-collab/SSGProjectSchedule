import { Router } from 'express';
import { db, logActivity } from '../db.js';
import { requireAuth, requirePM } from '../auth.js';

const router = Router();
router.use(requireAuth);

/** Extra stage beyond the six defaults — project managers only. */
router.post('/', requirePM, (req, res) => {
  const projectId = Number(req.body?.projectId);
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Stage name is required' });
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const pos = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM phases WHERE project_id = ?')
    .get(projectId).m;
  const info = db
    .prepare('INSERT INTO phases (project_id, name, position, pic_user_id) VALUES (?, ?, ?, ?)')
    .run(projectId, name, pos + 1, Number(req.body?.picUserId) || null);

  logActivity(projectId, req.user.id, 'added stage', name);
  res.status(201).json({ phaseId: Number(info.lastInsertRowid) });
});

/** Rename a stage or (re)assign its PIC. Assigning a PIC is a PM-only decision. */
router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const phase = db.prepare('SELECT * FROM phases WHERE id = ?').get(id);
  if (!phase) return res.status(404).json({ error: 'Stage not found' });

  const isPM = req.user.role === 'pm';
  const isPic = phase.pic_user_id === req.user.id;
  if (!isPM && !isPic) return res.status(403).json({ error: 'You cannot edit this stage' });

  const name = req.body?.name === undefined ? phase.name : String(req.body.name).trim();
  if (!name) return res.status(400).json({ error: 'Stage name is required' });

  let picUserId = phase.pic_user_id;
  if (req.body?.picUserId !== undefined) {
    if (!isPM) return res.status(403).json({ error: 'Only a project manager can assign the PIC' });
    const raw = req.body.picUserId;
    if (raw === null || raw === '') {
      picUserId = null;
    } else {
      const user = db.prepare('SELECT id, name FROM users WHERE id = ? AND active = 1').get(Number(raw));
      if (!user) return res.status(400).json({ error: 'That user does not exist' });
      picUserId = user.id;
      logActivity(phase.project_id, req.user.id, 'assigned PIC', `${user.name} → ${name}`);
    }
  }

  db.prepare('UPDATE phases SET name = ?, pic_user_id = ? WHERE id = ?').run(name, picUserId, id);
  res.json({ ok: true });
});

router.delete('/:id', requirePM, (req, res) => {
  const id = Number(req.params.id);
  const phase = db.prepare('SELECT * FROM phases WHERE id = ?').get(id);
  if (!phase) return res.status(404).json({ error: 'Stage not found' });
  db.prepare('DELETE FROM phases WHERE id = ?').run(id);
  logActivity(phase.project_id, req.user.id, 'removed stage', phase.name);
  res.json({ ok: true });
});

export default router;
