import { Router } from 'express';
import { logActivity, one, run } from '../db.js';
import { requireAuth, requirePM } from '../auth.js';
import { a, idParam, toId } from '../util.js';

const router = Router();
router.use(requireAuth);
router.param('id', idParam);

/** Extra stage beyond the six defaults — project managers only. */
router.post('/', requirePM, a(async (req, res) => {
  const projectId = toId(req.body?.projectId);
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Stage name is required' });
  if (projectId === null) return res.status(404).json({ error: 'Project not found' });

  const project = await one('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { m } = await one(
    'SELECT coalesce(max(position), -1) AS m FROM phases WHERE project_id = ?',
    [projectId]
  );
  const phase = await one(
    'INSERT INTO phases (project_id, name, position, pic_user_id) VALUES (?, ?, ?, ?) RETURNING id',
    [projectId, name, m + 1, toId(req.body?.picUserId)]
  );

  await logActivity(projectId, req.user.id, 'added stage', name);
  res.status(201).json({ phaseId: phase.id });
}));

/** Rename a stage or (re)assign its PIC. Assigning a PIC is a PM-only decision. */
router.patch('/:id', a(async (req, res) => {
  const id = Number(req.params.id);
  const phase = await one('SELECT * FROM phases WHERE id = ?', [id]);
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
      const picId = toId(raw);
      const user = picId
        ? await one('SELECT id, name FROM users WHERE id = ? AND active = true', [picId])
        : null;
      if (!user) return res.status(400).json({ error: 'That user does not exist' });
      picUserId = user.id;
      await logActivity(phase.project_id, req.user.id, 'assigned PIC', `${user.name} → ${name}`);
    }
  }

  await run('UPDATE phases SET name = ?, pic_user_id = ? WHERE id = ?', [name, picUserId, id]);
  res.json({ ok: true });
}));

router.delete('/:id', requirePM, a(async (req, res) => {
  const id = Number(req.params.id);
  const phase = await one('SELECT * FROM phases WHERE id = ?', [id]);
  if (!phase) return res.status(404).json({ error: 'Stage not found' });
  await run('DELETE FROM phases WHERE id = ?', [id]);
  await logActivity(phase.project_id, req.user.id, 'removed stage', phase.name);
  res.json({ ok: true });
}));

export default router;
