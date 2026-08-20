import { Router } from 'express';
import { DEFAULT_PHASES, logActivity, many, one, run, tx } from '../db.js';
import { requireAuth, requirePM } from '../auth.js';
import { isIsoDate, todayIso } from '../dates.js';
import { a, idParam, toId } from '../util.js';

const router = Router();
router.use(requireAuth);
router.param('id', idParam);

async function serialiseProject(p) {
  const phaseRows = await many(
    `SELECT ph.*, u.name AS pic_name, u.username AS pic_username
     FROM phases ph LEFT JOIN users u ON u.id = ph.pic_user_id
     WHERE ph.project_id = ? ORDER BY ph.position, ph.id`,
    [p.id]
  );

  // One query for every task in the project, then grouped in memory — a query per
  // phase would be six round trips to Supabase instead of two.
  const taskRows = await many(
    `SELECT t.*, u.name AS assignee_name,
            dep.name AS depends_on_name, dep.status AS depends_on_status
     FROM tasks t
     JOIN phases ph ON ph.id = t.phase_id
     LEFT JOIN users u ON u.id = t.assignee_id
     LEFT JOIN tasks dep ON dep.id = t.depends_on
     WHERE ph.project_id = ? ORDER BY t.position, t.id`,
    [p.id]
  );

  const tasksByPhase = new Map();
  for (const t of taskRows) {
    const list = tasksByPhase.get(t.phase_id) ?? [];
    list.push({
      id: t.id,
      phaseId: t.phase_id,
      name: t.name,
      status: t.status,
      startDate: t.start_date,
      endDate: t.end_date,
      selectedDates: t.selected_dates ?? [],
      assigneeId: t.assignee_id,
      assigneeName: t.assignee_name,
      dependsOn: t.depends_on,
      dependsOnName: t.depends_on_name,
      // Derived, never stored: blocked while the predecessor is not Complete.
      blocked: !!(t.depends_on && t.depends_on_status !== 'Complete'),
      notes: t.notes,
      position: t.position,
      updatedAt: t.updated_at,
    });
    tasksByPhase.set(t.phase_id, list);
  }

  return {
    id: p.id,
    name: p.name,
    company: p.company,
    location: p.location,
    client: p.client,
    description: p.description,
    startDate: p.start_date,
    status: p.status,
    position: p.position,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    phases: phaseRows.map((ph) => ({
      id: ph.id,
      projectId: ph.project_id,
      name: ph.name,
      position: ph.position,
      picUserId: ph.pic_user_id,
      picName: ph.pic_name,
      picUsername: ph.pic_username,
      tasks: tasksByPhase.get(ph.id) ?? [],
    })),
  };
}

router.get('/', a(async (req, res) => {
  const rows = await many(
    `SELECT p.*,
            count(t.id)::int AS total,
            coalesce(sum(CASE WHEN t.status = 'Complete' THEN 1 ELSE 0 END), 0)::int AS done,
            min(t.start_date) AS first_day,
            max(t.end_date) AS last_day,
            bool_or(ph.pic_user_id = ?) AS is_pic
     FROM projects p
     LEFT JOIN phases ph ON ph.project_id = p.id
     LEFT JOIN tasks t ON t.phase_id = ph.id
     GROUP BY p.id
     ORDER BY p.position, p.id`,
    [req.user.id]
  );

  res.json({
    projects: rows.map((p) => ({
      id: p.id,
      name: p.name,
      company: p.company,
      location: p.location,
      client: p.client,
      startDate: p.start_date,
      status: p.status,
      position: p.position,
      taskCount: p.total,
      doneCount: p.done,
      firstDay: p.first_day,
      lastDay: p.last_day,
      isPic: !!p.is_pic,
    })),
  });
}));

router.get('/:id', a(async (req, res) => {
  const p = await one('SELECT * FROM projects WHERE id = ?', [Number(req.params.id)]);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  res.json({ project: await serialiseProject(p) });
}));

router.get('/:id/activity', a(async (req, res) => {
  const rows = await many(
    `SELECT act.*, u.name AS user_name FROM activity act
     LEFT JOIN users u ON u.id = act.user_id
     WHERE act.project_id = ? ORDER BY act.id DESC LIMIT 60`,
    [Number(req.params.id)]
  );
  res.json({
    activity: rows.map((x) => ({
      id: x.id,
      userName: x.user_name || 'Someone',
      action: x.action,
      detail: x.detail,
      createdAt: x.created_at,
    })),
  });
}));

router.post('/', requirePM, a(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const company = String(req.body?.company || '').trim();
  const location = String(req.body?.location || '').trim();
  const client = String(req.body?.client || '').trim();
  const description = String(req.body?.description || '').trim();
  const startDate = String(req.body?.startDate || '').trim() || todayIso();

  if (!name) return res.status(400).json({ error: 'Project name is required' });
  if (!isIsoDate(startDate)) return res.status(400).json({ error: 'Start date is invalid' });

  const { m: maxPos } = await one('SELECT coalesce(max(position), -1) AS m FROM projects');
  const picks = Array.isArray(req.body?.phasePics) ? req.body.phasePics : [];

  const projectId = await tx(async (t) => {
    const project = await t.one(
      `INSERT INTO projects (name, company, location, client, description, start_date, position, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [name, company, location, client, description, startDate, maxPos + 1, req.user.id]
    );

    // Every project opens with the six standard SSG stages.
    for (const [i, phaseName] of DEFAULT_PHASES.entries()) {
      const picId = toId(picks[i]);
      const pic = picId
        ? await t.one('SELECT id FROM users WHERE id = ? AND active = true', [picId])
        : null;
      await t.run(
        'INSERT INTO phases (project_id, name, position, pic_user_id) VALUES (?, ?, ?, ?)',
        [project.id, phaseName, i, pic ? pic.id : null]
      );
    }
    return project.id;
  });

  await logActivity(projectId, req.user.id, 'created the project', name);
  const p = await one('SELECT * FROM projects WHERE id = ?', [projectId]);
  res.status(201).json({ project: await serialiseProject(p) });
}));

router.patch('/:id', requirePM, a(async (req, res) => {
  const id = Number(req.params.id);
  const p = await one('SELECT * FROM projects WHERE id = ?', [id]);
  if (!p) return res.status(404).json({ error: 'Project not found' });

  const next = {
    name: req.body?.name === undefined ? p.name : String(req.body.name).trim(),
    company: req.body?.company === undefined ? p.company : String(req.body.company).trim(),
    location: req.body?.location === undefined ? p.location : String(req.body.location).trim(),
    client: req.body?.client === undefined ? p.client : String(req.body.client).trim(),
    description:
      req.body?.description === undefined ? p.description : String(req.body.description).trim(),
    startDate: req.body?.startDate === undefined ? p.start_date : String(req.body.startDate).trim(),
    status: req.body?.status === undefined ? p.status : String(req.body.status),
  };

  if (!next.name) return res.status(400).json({ error: 'Project name is required' });
  if (!isIsoDate(next.startDate)) return res.status(400).json({ error: 'Start date is invalid' });
  if (!['Active', 'On Hold', 'Complete', 'Cancelled'].includes(next.status)) {
    return res.status(400).json({ error: 'Unknown project status' });
  }

  const updated = await one(
    `UPDATE projects SET name = ?, company = ?, location = ?, client = ?, description = ?,
     start_date = ?, status = ?, updated_at = now() WHERE id = ? RETURNING *`,
    [next.name, next.company, next.location, next.client, next.description,
     next.startDate, next.status, id]
  );

  await logActivity(id, req.user.id, 'updated project details', next.name);
  res.json({ project: await serialiseProject(updated) });
}));

router.delete('/:id', requirePM, a(async (req, res) => {
  const id = Number(req.params.id);
  const p = await one('SELECT * FROM projects WHERE id = ?', [id]);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  await run('DELETE FROM projects WHERE id = ?', [id]);
  res.json({ ok: true });
}));

export { serialiseProject };
export default router;
